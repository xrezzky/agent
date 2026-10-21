/**
 * Parser Server-Sent Events OpenRouter (dipisahkan agar mudah diuji).
 */



/**
 * Parser incrementable untuk Server-Sent Events OpenRouter:
 * baris "data: {...}" berisi chunk pilihan. Error upstream juga tiba
 * melalui format ini.
 */
export function createSseParser() {
  let buffer = "";
  return {
    *push(chunk: string): Generator<{
      text?: string;
      error?: string;
      finishReason?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }> {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue; // komentar keep-alive
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        type Chunk = {
          error?: { message?: string } | string;
          choices?: {
            delta?: { content?: string | null };
            finish_reason?: string | null;
          }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        let data: Chunk;
        try {
          data = JSON.parse(payload) as Chunk;
        } catch {
          continue; // baris rusak, abaikan
        }
        if (data.error) {
          const msg =
            typeof data.error === "string"
              ? data.error
              : data.error.message ?? "Kesalahan penyedia model.";
          yield { error: msg };
          continue;
        }
        const delta = data.choices?.[0]?.delta;
        const text = typeof delta?.content === "string" ? delta.content : "";
        const finishReason = data.choices?.[0]?.finish_reason ?? undefined;
        const usage = data.usage;
        if (text || finishReason || usage) yield { text, finishReason, usage };
      }
    },
  };
}
