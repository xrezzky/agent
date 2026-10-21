import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import {
  callOpenRouterStream,
  buildAttemptOrder,
  FailoverError,
} from "@/lib/openrouter";
import { MAX_CONTEXT_CHARS } from "@/lib/constants";
import { createSseParser } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface IncomingFile {
  name: string;
  type: string;
  /** Cuplikan teks hasil ekstraksi (teks/pdf/zip) — sudah dipotong di klien. */
  text?: string;
  /** Data URL gambar untuk model vision (terkompresi di klien). */
  dataUrl?: string;
}

interface ChatBody {
  messages?: { role: string; content?: string }[];
  model?: string | null;
  files?: IncomingFile[];
  /** Petunjuk mode aktif untuk system prompt. */
  mode?: "chat" | "coding";
}

/**
 * POST /api/chat
 * Menerima riwayat pesan + model pilihan pengguna, mengembalikan stream
 * NDJSON dengan event: meta | delta | error | done.
 *
 * Failover: sebelum satu byte dikirim ke browser, semua percobaan model
 * diperbolehkan. Begitu konten mulai mengalir, tidak ada percobaan kedua
 * yang bisa menggandakan jawaban.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Sesi berakhir. Silakan login ulang." }, { status: 401 });
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY belum dikonfigurasi di server. Lihat README bagian OpenRouter." },
      { status: 503 }
    );
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  if (incoming.length === 0 || incoming.length > 200) {
    return NextResponse.json({ error: "Konteks percakapan tidak valid." }, { status: 400 });
  }
  if (incoming[incoming.length - 1]?.role !== "user") {
    return NextResponse.json({ error: "Pesan terakhir harus dari pengguna." }, { status: 400 });
  }

  // Validasi riwayat pesan.
  const history: { role: "user" | "assistant"; content: string }[] = [];
  for (const msg of incoming) {
    const role = msg?.role;
    const content = typeof msg?.content === "string" ? msg.content : "";
    if ((role !== "user" && role !== "assistant") || !content) {
      return NextResponse.json({ error: "Struktur pesan tidak valid." }, { status: 400 });
    }
    if (content.length > 100_000) {
      return NextResponse.json(
        { error: "Ada pesan yang terlalu panjang (>100 ribu karakter)." },
        { status: 413 }
      );
    }
    history.push({ role, content });
  }

  // Validasi file lampiran.
  const files = (Array.isArray(body.files) ? body.files : []).slice(0, 24);
  const preparedFiles: IncomingFile[] = [];
  let contextBudget = MAX_CONTEXT_CHARS;
  for (const f of files) {
    if (!f || typeof f.name !== "string" || f.name.length > 300) continue;
    const hasText = typeof f.text === "string" && f.text.length > 0;
    const hasImage =
      typeof f.dataUrl === "string" && f.dataUrl.startsWith("data:image/");
    if (!hasText && !hasImage) continue;
    if (hasImage && f.dataUrl!.length > 4_500_000) continue; // hemat body limit
    let file = f;
    if (hasText) {
      const text = f.text!.slice(0, Math.max(contextBudget, 0));
      contextBudget -= text.length;
      if (!text) continue;
      file = { ...f, text };
    }
    preparedFiles.push(file);
  }

  const manual = typeof body.model === "string" && body.model !== "auto" ? body.model : null;
  const isCoding = body.mode === "coding";
  const order = buildAttemptOrder(manual);
  if (order.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada model yang dikonfigurasi. Cek MODEL_CHAIN/FALLBACK_MODEL." },
      { status: 503 }
    );
  }

  const systemPrompt = buildSystemPrompt(isCoding);
  const encoder = new TextEncoder();

  /* ---------------------- Generator failover ---------------------- */
  async function* generate(): AsyncGenerator<Uint8Array> {
    const failures: string[] = [];
    let committed = false;

    for (const candidate of order) {
      if (committed) break;
      let upstream: Response;
      try {
        upstream = await callOpenRouterStream({
          model: candidate.id,
          messages: assembleMessages(systemPrompt, preparedFiles, history),
          signal: req.signal,
        });
      } catch (err) {
        if (err instanceof FailoverError) {
          failures.push(`${candidate.id}: ${err.reason}`);
          continue; // belum mengirim apa pun ke browser → aman pindah model
        }
        if (err instanceof Error && err.name === "AbortError") {
          yield encodeEvent({ type: "done", text: "", model: candidate.id }); // dibatalkan pengguna
          return;
        }
        const message =
          err instanceof Error ? err.message : "Permintaan ke penyedia model gagal.";
        yield encodeEvent({ type: "error", message, code: "upstream" });
        return;
      }

      // Upstream 200 dan body tersedia → mulai parsing SSE.
      const parser = createSseParser();
      let emitted = "";
      let streamedAnything = false;
      let finishReason: string | undefined;
      let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

      try {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        let dbgReads = 0;
        console.warn(`[chat-debug] mulai baca stream ${candidate.id}`);
        outer: for (;;) {
          const { done, value } = await reader.read();
          dbgReads += 1;
          if (dbgReads === 1) console.warn(`[chat-debug] baca pertama len=${value?.length ?? "done"}`);
          if (done) break;
          for (const parsed of parser.push(decoder.decode(value, { stream: true }))) {
            if (parsed.error) {
              // Error dari SSE upstream. Jika belum mengirim konten, kita
              // masih boleh pindah model; jika sudah, laporkan apa adanya.
              if (!streamedAnything) {
                const reason = /rate/i.test(parsed.error) ? "rate-limit" : "gangguan";
                failures.push(`${candidate.id}: ${parsed.error}`);
                try {
                  void reader.cancel();
                } catch {
                  /* lewati */
                }
                committed = false;
                break outer;
              }
              yield encodeEvent({ type: "error", message: parsed.error });
              yield encodeEvent({
                type: "done",
                text: emitted,
                model: candidate.id,
              });
              return;
            }
            if (parsed.text) {
              if (!streamedAnything) {
                streamedAnything = true;
                committed = true;
                yield encodeEvent({
                  type: "meta",
                  model: candidate.id,
                  note: failures.length
                    ? `Berpindah model setelah nomor ${failures.length} percobaan gagal.`
                    : undefined,
                });
              }
              emitted += parsed.text;
              yield encodeEvent({ type: "delta", text: parsed.text });
            }
            if (parsed.finishReason) finishReason = parsed.finishReason;
            if (parsed.usage) usage = parsed.usage;
          }
        }

        // Stream selesai normal.
        if (!streamedAnything) {
          failures.push(`${candidate.id}: tidak menghasilkan konten`);
          continue;
        }
        yield encodeEvent({ type: "done", text: emitted, model: candidate.id });
        console.info(
          `[chat] model=${candidate.id} finish=${finishReason ?? "-"} ` +
            `tokens=${usage?.prompt_tokens ?? "-"}/${usage?.completion_tokens ?? "-"}`
        );
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          yield encodeEvent({ type: "done", text: emitted, model: candidate.id });
          return;
        }
        if (streamedAnything) {
          yield encodeEvent({
            type: "error",
            message: "Koneksi ke model terputus di tengah jawaban.",
          });
          yield encodeEvent({ type: "done", text: emitted, model: candidate.id });
          return;
        }
        // Gangguan sebelum konten apa pun keluar → boleh pindah model.
        failures.push(`${candidate.id}: jaringan/parse gagal`);
        continue;
      }
    }

    // Semua kandidat gagal.
    yield encodeEvent({
      type: "error",
      message:
        `Semua model gagal dipakai.\n` +
        failures.map((f) => `• ${f}`).join("\n") +
        `\nCoba lagi beberapa saat, atau pilih model lain secara manual.`,
      code: "all-models-failed",
    });
  }

  return new Response(
    generate() as unknown as BodyInit,
    {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    }
  );

  function encodeEvent(ev: unknown): Uint8Array {
    return encoder.encode(JSON.stringify(ev) + "\n");
  }
}

/* ------------------------- System prompt ------------------------- */

function buildSystemPrompt(isCoding: boolean): string {
  const tanggal = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
  const base =
    "Kamu adalah asisten AI pribadi milik pemilik aplikasi ini. " +
    "Bersikaplah ringkas, akurat, dan ramah. Jawab dengan Bahasa Indonesia " +
    "kecuali pengguna memakai bahasa lain. Untuk kode, beri blok kode dengan " +
    "bahasa yang tepat. Jangan mengarang fakta; sampaikan bila ragu.";
  const coding =
    isCoding
      ? " Pengguna sedang memakai mode Coding: fokuskan jawaban pada analisis " +
        "struktur proyek, penjelasan kode, bug, dan saran perubahan. " +
        "AI tidak mengeksekusi kode dan tidak mengubah file di server; " +
        "sparahkan agar pengguna meninjau hasilnya sendiri."
      : "";
  return `${base}${coding} Tanggal saat ini: ${tanggal}.`;
}

/* --------------------- Rakit pesan upstream --------------------- */

function assembleMessages(
  systemPrompt: string,
  files: IncomingFile[],
  history: { role: "user" | "assistant"; content: string }[]
): { role: "system" | "user" | "assistant"; content: unknown }[] {
  const messages: { role: "system" | "user" | "assistant"; content: unknown }[] = [
    { role: "system", content: systemPrompt },
  ];

  // Teks file dikirim sebagai pesan system konteks terpisah.
  if (files.length > 0) {
    const textParts: string[] = [];
    const images: { name: string; dataUrl: string }[] = [];
    for (const f of files) {
      if (f.text && f.text.trim()) {
        textParts.push(
          `### File: ${f.name}\n(Sumber: ${f.type || "jenis tidak diketahui"})\n` +
            f.text
        );
      }
      if (f.dataUrl) images.push({ name: f.name, dataUrl: f.dataUrl });
    }
    if (textParts.length) {
      messages.push({
        role: "system",
        content:
          "Konteks file yang dilampirkan pengguna (boleh terpotong, analisis " +
          "berdasarkan bagian yang tersedia dan sebutkan bila ada yang tidak " +
          "terbaca):\n\n" +
          textParts.join("\n\n---\n\n"),
      });
    }

    // Gambar menempel pada pesan user terakhir (content array untuk vision).
    if (images.length) {
      const last = history[history.length - 1];
      const multiParts: unknown[] = [
        { type: "text", text: last.content },
        ...images.map((img) => ({
          type: "image_url",
          image_url: { url: img.dataUrl },
        })),
      ];
      messages.push(...history.slice(0, -1).map((m) => ({ role: m.role, content: m.content })));
      messages.push({ role: "user", content: multiParts });
      return messages;
    }
  }

  messages.push(...history.map((m) => ({ role: m.role, content: m.content })));
  return messages;
}
