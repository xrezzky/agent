"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { FileIcon } from "./icons";
import type { ChatMessage } from "@/lib/types";

/** Sebuah gelembung pesan; assistant memakai markdown lengkap. */
export default memo(function Message({
  message,
  streaming,
  onRegenerate,
}: {
  message: ChatMessage;
  streaming?: boolean;
  onRegenerate?: () => void;
}) {
  const isUser = message.role === "user";

  return (
    <article
      className={`flex w-full flex-col animate-fade-in ${isUser ? "items-end" : "items-start"}`}
      aria-label={isUser ? "Pesan Anda" : "Jawaban AI"}
    >
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-2xl bg-accent-500 px-4 py-2.5 text-[0.9375rem] leading-relaxed text-white shadow-sm sm:max-w-[70%]"
            : "max-w-full"
        }
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <div className="prose-chat">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {message.content || (streaming ? "" : "*(jawaban kosong)*")}
            </ReactMarkdown>
            {streaming && (
              <span className="inline-block h-4 w-2 animate-pulse-soft rounded-sm bg-accent-500 align-text-bottom" aria-hidden />
            )}
          </div>
        )}
      </div>

      {!isUser && !streaming && message.content && (
        <div className="mt-1 flex items-center gap-1 text-xs text-ink-400 dark:text-ink-500">
          {message.model && (
            <span className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono dark:bg-ink-850">
              {message.model}
            </span>
          )}
          {message.note && (
            <span title={message.note} className="cursor-help text-amber-600 dark:text-amber-400">
              ↻ failover
            </span>
          )}
          <CopyButton text={message.content} />
          {message.error && (
            <span className="text-red-500">• {message.error}</span>
          )}
          {message.stopped && <span>• dihentikan</span>}
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="rounded-md px-1.5 py-0.5 transition hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-850 dark:hover:text-ink-200"
              title="Ulangi jawaban ini"
            >
              ↻ Ulangi
            </button>
          )}
        </div>
      )}

      {isUser && message.attachments && message.attachments.length > 0 && (
        <div className="mt-1 flex max-w-[85%] flex-wrap gap-1.5">
          {message.attachments.map((a) => (
            <span
              key={a.id}
              className="flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-850 dark:text-ink-300"
              title={a.processNote || a.name}
            >
              {a.dataUrl && a.type.startsWith("image/") ? (
                <img src={a.dataUrl} alt={a.name} className="h-4 w-4 rounded object-cover" />
              ) : (
                <FileIcon />
              )}
              <span className="max-w-[160px] truncate">{a.name}</span>
            </span>
          ))}
        </div>
      )}
    </article>
  );
});


function CopyButton({ text, alwaysShow = false }: { text: string; alwaysShow?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard ditolak browser */
        }
      }}
      className={alwaysShow ? "" : "rounded-md px-1.5 py-0.5 transition hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-850 dark:hover:text-ink-200"}
      title="Salin"
    >
      {copied ? "Tersalin ✓" : "⧉ Salin"}
    </button>
  );
}
