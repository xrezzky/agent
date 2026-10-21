/**
 * Upstream OpenRouter tiruan untuk pengujian failover end-to-end.
 * - /api/v1/chat/completions  model "test/model-a" → selalu 429 (Rate limit)
 *                             model lainnya      → SSE stream normal
 * - /api/v1/models            daftar model minimal
 */
import http from "node:http"
const FLUSH_PAD = `: pad-${"".padEnd(16384, "x")}\n`;;
import crypto from "node:crypto";

const PORT = Number(process.env.FAKE_PORT || 9999);

const server = http.createServer((req, res) => {
  req.on("error", () => {});
  res.on("error", () => {});
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let requested = "";
    try {
      requested = JSON.parse(body || "{}").model ?? "";
    } catch {
      requested = "";
    }

    if (url.pathname.endsWith("/chat/completions")) {
      if (requested === "test/model-a") {
        res.writeHead(429, { "Retry-After": "2", "Content-Type": "text/plain" });
        res.end('{"error":{"message":"Rate limit exceeded for free models"}}');
        return;
      }
      if (requested === "test/model-crash") {
        try {
          res.destroy();
        } catch {
          /* klien sudah pergi */
        }
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const chunks = ["Halo", " dari", " model", " tiruan", " (", requested, ")"];
      const id = crypto.randomUUID();
      let i = 0;
      const timer = setInterval(() => {
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
      }, 30);
      req.on("close", () => clearInterval(timer));
      return;
    }

    if (url.pathname.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [
            { id: "test/model-b", name: "Model B", architecture: { input_modalities: ["text"] } },
            { id: "test/model-c", name: "Model C" },
          ],
        })
      );
      return;
    }

    res.writeHead(404).end();
  });
});

server.on("clientError", () => {});
server.on("error", () => {});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake openrouter siap di http://127.0.0.1:${PORT}`);
});
