/**
 * Klien chat di sisi browser: mem-parse stream NDJSON dari /api/chat,
 * menyingkir kerumitan protokol dari komponen UI.
 */
import type { ChatStreamEvent, ChatMessage, ModelChoice, AttachmentMeta } from "./types";

export interface ChatClientOptions {
  messages: { role: "user" | "assistant"; content: string }[];
  modelChoice: ModelChoice;
  mode: "chat" | "coding";
  /** Fungsi mengekstrak konteks lampiran (teks/gambar) di klien. */
  buildFiles: () => Promise<ChatClientFile[]>;
  onDelta: (text: string) => void;
  onMeta: (model: string, note?: string) => void;
  onDone: (result: { text: string; model: string; note?: string }) => void;
  onError: (message: string, code?: string) => void;
  signal: AbortSignal;
}

export interface ChatClientFile {
  name: string;
  type: string;
  text?: string;
  dataUrl?: string;
}

/** Menjalankan satu kali kirim + konsumsi stream. */
export async function runChat(opts: ChatClientOptions): Promise<void> {
  let files: ChatClientFile[] = [];
  try {
    files = await opts.buildFiles();
  } catch (err) {
    opts.onError(
      err instanceof Error
        ? `Lampiran gagal diproses: ${err.message}`
        : "Lampiran gagal diproses."
    );
    return;
  }

  let began = false;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: opts.signal,
      body: JSON.stringify({
        messages: opts.messages,
        model: opts.modelChoice.mode === "auto" ? "auto" : opts.modelChoice.model,
        mode: opts.mode,
        files,
      }),
    });

    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      opts.onError(data.error ?? `Server menolak permintaan (${res.status}).`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let event: ChatStreamEvent;
        try {
          event = JSON.parse(line) as ChatStreamEvent;
        } catch {
          continue;
        }
        switch (event.type) {
          case "meta":
            opts.onMeta(event.model, event.note);
            began = true;
            break;
          case "delta":
            began = true;
            opts.onDelta(event.text);
            break;
          case "error":
            opts.onError(event.message, event.code);
            break;
          case "done":
            opts.onDone({ text: event.text, model: event.model, note: event.note });
            return;
        }
      }
    }

    // Stream berakhir tanpa event done (mis. jaringan putus).
    opts.onError(
      began
        ? "Jawaban terputus sebelum selesai. Coba ulangi jawaban."
        : "Tidak ada jawaban dari model."
    );
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      opts.onDone({ text: "", model: opts.modelChoice.mode === "auto" ? "auto" : opts.modelChoice.model });
      return;
    }
    opts.onError((err as Error)?.message ?? "Permintaan gagal.");
  }
}

/** Membangun konteks lampiran untuk dikirim (teks diekstrak saat kirim). */
export async function buildFilePayload(
  attachments: AttachmentMeta[],
  fileMap: Map<string, File>,
  maxChars: number
): Promise<ChatClientFile[]> {
  const out: ChatClientFile[] = [];
  let budget = maxChars;
  const { classifyFile, extractAttachmentText } = await import("./files");

  for (const att of attachments) {
    const cls = classifyFile(att.name, att.type);
    if (cls === "image") {
      if (att.dataUrl) {
        out.push({ name: att.name, type: att.type, dataUrl: att.dataUrl });
      }
      continue;
    }
    let text: string | null = null;
    try {
      text = await extractAttachmentText(att, fileMap);
    } catch {
      text = null;
    }
    if (text) {
      const slice = text.slice(0, Math.max(budget, 0));
      budget -= slice.length;
      if (!slice) {
        out.push({ name: att.name, type: att.type });
        continue;
      }
      out.push({ name: att.name, type: att.type, text: slice });
    } else {
      out.push({ name: att.name, type: att.type });
    }
  }
  return out;
}
