/**
 * Uji end-to-end mini: menjalankan OpenRouter tiruan + `next start`,
 * lalu memverifikasi alur auth → middleware → chat streaming → failover.
 * Dipakai untuk pengujian lokal; tidak butuh kredensial nyata.
 *
 * Jalankan: node scripts/e2e-run.mjs   (butuh build `next build` dulu)
 */
import { spawn, execFileSync } from "node:child_process";
import http from "node:http"
const FLUSH_PAD = `: pad-${"".padEnd(16384, "x")}\n`;;
import crypto from "node:crypto";
import { createHash } from "node:crypto";

const FAKE_PORT = 9999;
const APP_PORT = 3112;
const PASSWORD = "e2e-rahasia-123";
const PASSWORD_HASH = createHash("sha256").update(PASSWORD).digest("hex");
const AUTH_SECRET = "x".repeat(32);

let results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok, extra });
  console.log(`${ok ? "✔" : "✘"} ${name}${extra ? " — " + extra : ""}`);
}

/* ------------------------- upstream tiruan ------------------------- */
function startFake() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      req.on("error", () => {});
      res.on("error", () => {});
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let model = "";
        try {
          model = JSON.parse(body || "{}").model ?? "";
        } catch {
          /* body tidak valid */
        }
        if (req.url?.includes("/chat/completions")) {
          if (model === "test/model-a") {
            res.writeHead(429, { "Retry-After": "1", "Content-Type": "text/plain" });
            res.end('{"error":{"message":"Rate limit exceeded"}}');
            return;
          }
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          const chunks = ["Halo", " dari", " model-e2e"];
          let i = 0;
          const id = crypto.randomUUID();
          const timer = setInterval(() => {
            try {
              if (i < chunks.length) {
                res.write(FLUSH_PAD + `data: ${JSON.stringify({ id, choices: [{ delta: { content: chunks[i] } }] })}\n\n`);
                i += 1;
              } else {
                res.write(
                  FLUSH_PAD + `data: ${JSON.stringify({ id, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`
                );
                res.write(FLUSH_PAD + "data: [DONE]\n\n");
                clearInterval(timer);
                res.end();
              }
            } catch {
              clearInterval(timer);
            }
          }, 25);
          req.on("close", () => clearInterval(timer));
          return;
        }
        res.writeHead(404).end();
      });
    });
    server.on("clientError", () => {});
    server.listen(FAKE_PORT, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

/* ---------------------------- util fetch ---------------------------- */
const B = `http://127.0.0.1:${APP_PORT}`;

async function untilReady(ms = 45000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await fetch(`${B}/login`, { signal: AbortSignal.timeout(1500) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

async function main() {
  const fake = spawn(process.execPath, ['scripts/fake-openrouter.mjs'], { cwd: process.cwd(), env: { ...process.env, FAKE_PORT: String(FAKE_PORT) } });
  fake.stdout.on('data', () => {});
  fake.stderr.on('data', (d) => process.stderr.write('[fake] ' + String(d)));
  const app = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)],
    {
      cwd: process.cwd(),
      detached: false,
      env: {
        ...process.env,
        NODE_ENV: "production",
        OPENROUTER_API_KEY: "sk-e2e-palsu",
        OPENROUTER_BASE_URL: `http://127.0.0.1:9999/api/v1`,
        MODEL_CHAIN: "test/model-a,test/model-b",
        FALLBACK_MODEL: "test/model-b",
        OWNER_USERNAME: "e2e",
        OWNER_PASSWORD_HASH: PASSWORD_HASH,
        AUTH_SECRET,
        PORT: String(APP_PORT),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  app.stdout.on("data", (d) => process.stderr.write("[next-out] " + String(d)));
  app.stderr.on("data", (d) =>
    console.log("[next]", String(d).trim().split("\n").slice(-1)[0])
  );

  try {
    check("server siap", await untilReady());

    /* Tanpa sesi harus dipindah ke /login */
    const root = await fetch(`${B}/`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    check("middleware: root → login", root.status === 307 && (root.headers.get("location") ?? "").includes("/login"));

    /* login salah */
    const bad = await fetch(`${B}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "e2e", password: "salah" }),
      signal: AbortSignal.timeout(5000),
    });
    check("login ditolak dengan 401", bad.status === 401);

    /* login benar */
    const ok = await fetch(`${B}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "e2e", password: PASSWORD }),
      signal: AbortSignal.timeout(5000),
    });
    const cookie = (ok.headers.get("set-cookie") ?? "").split(";")[0];
    check("login berhasil tahap 204 + cookie", ok.status === 204 && cookie.startsWith("pa_session="), cookie.slice(0, 24) + "…");

    /* root dengan cookie */
    const root2 = await fetch(`${B}/`, {
      redirect: "manual",
      headers: { cookie },
      signal: AbortSignal.timeout(5000),
    });
    check("middleware: root dengan sesi 200", root2.status === 200);

    /* status */
    const status = await fetch(`${B}/api/status`, { headers: { cookie }, signal: AbortSignal.timeout(5000) });
    const st = (await status.json()) ?? {};
    check("status: openrouter aktif", status.ok && st.openrouter === true);
    check("status: storage belum disetel", st.storage === false);

    /* chat tanpa cookie → 401 */
    const anonChat = await fetch(`${B}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      signal: AbortSignal.timeout(5000),
    });
    check("chat tanpa sesi → 401", anonChat.status === 401);

    /* upload tanpa storage → 503 + petunjuk */
    const upload = await fetch(`${B}/api/upload/init`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "x.zip", size: 2048, type: "application/zip" }),
      signal: AbortSignal.timeout(5000),
    });
    const up = (await upload.json()) ?? {};
    check("upload tanpa storage → 503 + petunjuk", upload.status === 503 && (up.hint ?? "").includes("S3_ENDPOINT"));

    /* chat dengan sesi: failover model-a (429) → model-b (stream) */
    const chat = await fetch(`${B}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ messages: [{ role: "user", content: "tes" }], model: "auto" }),
      signal: AbortSignal.timeout(30000),
    });
    check("chat 200", chat.ok);
    const text = await chat.text();
    const events = text.split("\n").filter(Boolean).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    });
    const meta = events.find((e) => e?.type === "meta");
    const deltas = events.filter((e) => e?.type === "delta");
    const done = events.find((e) => e?.type === "done");
    check("meta: model aktif = model-b", meta?.model === "test/model-b", meta?.model ?? "-");
    check("delta: konten mengalir", deltas.map((e) => e.text).join("") === "Halo dari model-e2e");
    check("done: teks utuh + model", done?.text === "Halo dari model-e2e" && done?.model === "test/model-b");

    /* mode manual */
    const chat2 = await fetch(`${B}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        messages: [{ role: "user", content: "tes2" }],
        model: "test/model-a",
      }),
      signal: AbortSignal.timeout(30000),
    });
    const text2 = await chat2.text();
    const meta2 = text2
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .find((e) => e?.type === "meta");
    check("mode manual: model gagal 429 → beralih ke rantai", meta2?.model === "test/model-b", meta2?.model ?? "-");
  } finally {
    app.kill("SIGKILL");
    fake.kill("SIGKILL");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRingkasan: ${results.length - failed.length}/${results.length} lulus`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("✘ E2E gagal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
