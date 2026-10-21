/**
 * Klien upstream OpenRouter (server-only).
 * API key tidak pernah keluar dari modul ini.
 */
import { MAX_MODEL_ATTEMPTS } from "./constants";
import { getFallbackModel, getModelChain, type ModelInfo } from "./models";

const OR_BASE =
  process.env.OPENROUTER_BASE_URL?.replace(/\/+$/, "") ?? "https://openrouter.ai/api/v1";

/* ------------------- Kebijakan failover ------------------- */

/** Status cooldown per model agar tidak dipukul terus-menerus. */
const cooldownUntil = new Map<string, number>();

function markFailure(modelId: string, retryAfterMs: number, reason: string) {
  const until = Date.now() + Math.min(retryAfterMs, 60_000);
  cooldownUntil.set(modelId, until);
  console.warn(
    `[failover] ${modelId} gagal (${reason}); cooldown ${Math.round((until - Date.now()) / 1000)}s`
  );
}

function isCooling(modelId: string): boolean {
  const until = cooldownUntil.get(modelId) ?? 0;
  return Date.now() < until;
}

/** Error yang layak dicoba ke model berikutnya. */
export class FailoverError extends Error {
  constructor(
    message: string,
    public readonly modelId: string,
    public readonly reason: string,
    public readonly retryAfterMs?: number
  ) {
    super(message);
  }
}

/**
 * Menyusun urutan kandidat model untuk satu permintaan.
 * - mode manual: model terpilih dulu, lalu rantai prioritas sebagai cadangan.
 * - mode auto  : rantai prioritas langsung.
 * Diteruskan hanya permintaan yang masih dalam batas percobaan.
 */
export function buildAttemptOrder(manualModel: string | null): ModelInfo[] {
  const chain = getModelChain();
  const fallback = getFallbackModel();
  const seen = new Set<string>();
  const order: ModelInfo[] = [];
  if (manualModel && manualModel !== "auto") {
    order.push({ id: manualModel, label: manualModel });
    seen.add(manualModel);
  }
  for (const m of chain) {
    if (!seen.has(m.id)) {
      order.push(m);
      seen.add(m.id);
    }
  }
  if (!seen.has(fallback.id)) order.push(fallback);
  // Batasi jumlah model yang benar-benar dicoba.
  return order.slice(0, MAX_MODEL_ATTEMPTS);
}


/* ------------------- Pemanggilan upstream ------------------- */

export interface UpstreamRequest {
  messages: { role: "system" | "user" | "assistant"; content: unknown }[];
  model: string;
  signal: AbortSignal;
  temperature?: number;
}

/**
 * Melakukan satu percobaan panggilan streaming ke OpenRouter.
 * Memakai node:http/https langsung (bukan fetch) agar tidak tersentuh
 * patch caching Next; streaming SSE mengalir apa adanya.
 */
export async function callOpenRouterStream(req: UpstreamRequest): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY belum dikonfigurasi di server.");
  }

  const url = new URL(`${OR_BASE}/chat/completions`);
  const mod = url.protocol === "https:" ? await import("node:https") : await import("node:http");

  const payload = JSON.stringify({
    model: req.model,
    messages: req.messages,
    stream: true,
    temperature: req.temperature ?? 0.7,
  });

  return new Promise<Response>((fulfill, reject) => {
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    req.signal.addEventListener("abort", onOuterAbort, { once: true });
    const connectTimer = setTimeout(() => controller.abort(), 45_000);

        const request = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        agent: false,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "HTTP-Referer": process.env.APP_PUBLIC_URL ?? "http://localhost:3000",
          "X-Title": "Web AI Pribadi",
        },
      },
      (res) => {
                clearTimeout(connectTimer);
        req.signal.removeEventListener("abort", onOuterAbort);

        res.on("error", () => reject(new FailoverError(
          `Model ${req.model} tidak dapat dihubungi.`,
          req.model,
          "network"
        )));

        if (
          res.statusCode &&
          res.statusCode >= 200 &&
          res.statusCode < 300 &&
          res.statusCode !== 204
        ) {
          const stream = new ReadableStream<Uint8Array>({
            start(c) {
              res.on("data", (chunk: Buffer) => {
                c.enqueue(new Uint8Array(chunk));
              });
              res.on("end", () => {
                try { c.close(); } catch { /* tutup gagal */ }
              });
            },
            cancel() {
              res.destroy();
            },
          });
          fulfill(
            new Response(stream, {
              status: res.statusCode,
              headers: { "content-type": res.headers["content-type"] ?? "text/event-stream" },
            })
          );
          return;
        }

        // Status gagal: kumpulkan body untuk pesan yang jelas.
        let text = "";
        res.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
        res.on("end", () => {
          const reason = classifyUpstreamFailure(res.statusCode ?? 500, text);
          if (reason) {
            markFailure(req.model, 10_000, `${res.statusCode}`);
            reject(
              new FailoverError(
                `Model ${req.model} gagal (${res.statusCode}).`,
                req.model,
                reason
              )
            );
            return;
          }
          reject(
            new Error(
              `Permintaan ditolak (${res.statusCode}): ${truncate(text || "pesan tidak valid", 300)}`
            )
          );
        });
      }
    );

    request.on("error", (err) => {
      clearTimeout(connectTimer);
      if (controller.signal.aborted) {
        if (req.signal.aborted) {
          const abortError = new Error("Permintaan dibatalkan.");
          abortError.name = "AbortError";
          reject(abortError);
          return;
        }
        markFailure(req.model, 15_000, "timeout");
        reject(
          new FailoverError(
            `Model ${req.model} melebihi batas waktu koneksi.`,
            req.model,
            "timeout"
          )
        );
        return;
      }
      void err;
      reject(
        new FailoverError(
          `Model ${req.model} tidak dapat dihubungi.`,
          req.model,
          "network"
        )
      );
    });

    request.write(payload);
    request.end();
  });
}

/**
 * Klasifikasi status upstream:
 * - string  → layak pindah model.
 * - null    → tidak layak (kesalahan dari sisi permintaan).
 */
function classifyUpstreamFailure(status: number, text: string): string | null {
  if (status === 429) return "rate-limit";
  if (status === 402) return "credit-habis";
  if (status === 408 || status === 409) return "gangguan-sementara";
  if (status >= 500) return "server-upstream";
  if (status === 404) return "model-tidak-ditemukan";
  // 400 kadang berarti model tidak menerima input ini (mis. gambar ke model
  // non-vision) — tetap boleh dicoba model lain.
  if (status === 400 && /not a valid model|no endpoints|does not (exist|support)/i.test(text)) {
    return "model-tidak-ditemukan";
  }
  return null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/* ------------------- Utilitas non-streaming ------------------- */

/** Panggilan sederhana tanpa streaming (dipakai utilitas internal). */
export async function callOpenRouterOnce(
  model: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  signal?: AbortSignal
): Promise<{ content: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY belum dikonfigurasi di server.");
  const res = await fetch(`${OR_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_PUBLIC_URL ?? "http://localhost:3000",
      "X-Title": "Web AI Pribadi",
    },
    signal,
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${truncate(text, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  return { content };
}
