"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachmentMeta } from "@/lib/types";
import { classifyFile, compressImage, uploadLargeFile, formatBytes, type UploadProgress } from "@/lib/files";
import { PaperclipIcon, SendIcon, StopIcon, XIcon } from "./icons";

function newAttachmentId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  attachments: AttachmentMeta[];
  onAttachmentsChange: (next: AttachmentMeta[]) => void;
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string, attachments: AttachmentMeta[]) => void;
  onStop: () => void;
  fileMap: Map<string, File>;
  onFileMapChange: (map: Map<string, File>) => void;
}

/**
 * Kolom pesan: Enter kirim, Shift+Enter baris baru, lampiran file
 * dengan progres upload, drag-and-drop di desktop.
 */
export default function Composer(props: Props) {
  const {
    value,
    onChange,
    attachments,
    onAttachmentsChange,
    disabled,
    streaming,
    onSend,
    onStop,
    fileMap,
    onFileMapChange,
  } = props;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progressRow, setProgressRow] = useState<{ name: string; p: UploadProgress; handle?: () => void } | null>(null);

  /** Auto-resize textarea. */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  const addFiles = useCallback(
    async (files: File[]) => {
      const next: AttachmentMeta[] = [...attachments];
      const map = new Map(fileMap);
      for (const file of files) {
        const id = newAttachmentId();
        const cls = classifyFile(file.name, file.type);
        const base: AttachmentMeta = {
          id,
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
          kind: "inline",
          processNote: undefined,
        };
        try {
          if (cls === "image") {
            base.dataUrl = await compressImage(file);
          } else if (cls === "text" || cls === "pdf" || cls === "zip") {
            map.set(id, file);
          } else {
            base.processNote = "Jenis file belum bisa dianalisis (biner).";
          }
        } catch {
          base.processNote = "Gagal membaca file di browser ini.";
        }
        next.push(base);
      }
      onAttachmentsChange(next);
      onFileMapChange(map);
    },
    [attachments, fileMap, onAttachmentsChange, onFileMapChange]
  );

  /** Siapkan lampiran sebelum kirim: kecil → inline, besar → storage. */
  async function prepareAttachments(): Promise<AttachmentMeta[]> {
    const prepared: AttachmentMeta[] = [];
    for (const att of attachments) {
      const file = fileMap.get(att.id);
      if (!file) {
        prepared.push(att); // sudah berupa inline dataUrl / s3
        continue;
      }
      if (file.size > 1024 * 1024) {
        prepared.push(await uploadToStorage(att, file));
      } else {
        const cls = classifyFile(file.name, file.type);
        if (cls === "image") {
          prepared.push(att); // dataUrl kompresi sudah dibuat saat addFiles
        } else if (att.dataUrl) {
          prepared.push(att);
        } else {
          prepared.push({ ...att, kind: "inline", dataUrl: await blobToDataUrl(file) });
        }
      }
    }
    return prepared;
  }

  async function uploadToStorage(att: AttachmentMeta, file: File): Promise<AttachmentMeta> {
    return new Promise<AttachmentMeta>((resolve, reject) => {
      const handle = uploadLargeFile(file, (p) => {
        setProgressRow({ name: file.name, p });
        cancelRef.current = handle.cancel;
      });
      setProgressRow({
        name: file.name,
        p: { sent: 0, total: file.size, phase: "persiapan" },
      });
      cancelRef.current = handle.cancel;
      handle.promise
        .then(({ objectKey }) => {
          setProgressRow(null);
          resolve({ ...att, kind: "s3", objectKey, processNote: undefined });
        })
        .catch((err: unknown) => {
          setProgressRow(null);
          if ((err as Error)?.name === "AbortError") {
            reject(new DOMException("Upload dibatalkan.", "AbortError"));
            return;
          }
          reject(err instanceof Error ? err : new Error("Upload gagal."));
        });
    });
  }

  const cancelRef = useRef<(() => void) | null>(null);

  async function handleSend() {
    if (streaming || disabled) return;
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    try {
      const prepared = await prepareAttachments();
      onSend(text, prepared);
    } catch (err) {
      alert(
        err instanceof Error
          ? `Lampiran gagal direalisasikan: ${err.message}`
          : "Lampiran gagal."
      );
    }
  }

  return (
    <div
      className="relative w-full"
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (e.dataTransfer?.types.includes("Files")) {
          e.preventDefault();
          setDragging(false);
          void addFiles(Array.from(e.dataTransfer.files).slice(0, 10));
        }
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute -inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent-500 bg-accent-500/5 text-sm text-accent-600 dark:text-accent-300">
          Lepaskan file untuk melampirkan
        </div>
      )}

      {progressRow && (
        <div className="absolute -top-14 left-0 right-0 z-10 mx-auto max-w-md rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-ink-800 dark:bg-ink-850">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate">
              {progressRow.name} — {Math.round((progressRow.p.sent / Math.max(1, progressRow.p.total)) * 100)}%
            </span>
            <div className="flex items-center gap-2">
              <span className="text-ink-400">{formatBytes(progressRow.p.sent)} / {formatBytes(progressRow.p.total)}</span>
              <button onClick={() => cancelRef.current?.()} className="text-ink-400 hover:text-red-500" aria-label="Batalkan upload">
                <XIcon />
              </button>
            </div>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
            <div
              className="h-full rounded-full bg-accent-500 transition-all"
              style={{ width: `${(progressRow.p.sent / Math.max(1, progressRow.p.total)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.id}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                a.processNote
                  ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                  : "border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-850"
              }`}
              title={a.processNote || `${a.name} (${formatBytes(a.size)})`}
            >
              {a.dataUrl && a.type.startsWith("image/") ? (
                <img src={a.dataUrl} alt="" className="h-4 w-4 rounded object-cover" />
              ) : (
                <PaperclipIcon />
              )}
              <span className="max-w-[140px] truncate">{a.name}</span>
              <button
                onClick={() => {
                  onAttachmentsChange(attachments.filter((x) => x.id !== a.id));
                  const map = new Map(fileMap);
                  map.delete(a.id);
                  onFileMapChange(map);
                }}
                className="text-ink-400 hover:text-red-500"
                aria-label={`Lepaskan ${a.name}`}
              >
                <XIcon />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-ink-200 bg-white p-2 shadow-sm transition focus-within:border-accent-400 dark:border-ink-800 dark:bg-ink-900">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="mb-0.5 rounded-xl p-2 text-ink-400 transition hover:bg-ink-100 hover:text-ink-600 dark:hover:bg-ink-850 dark:hover:text-ink-200"
          aria-label="Lampirkan file"
          title="Lampirkan file"
          disabled={streaming}
        >
          <PaperclipIcon />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={1}
          placeholder="Tulis pesan… (Enter kirim, Shift+Enter baris baru)"
          className="max-h-[200px] flex-1 resize-none bg-transparent py-2 text-[0.9375rem] leading-relaxed outline-none placeholder:text-ink-400"
        />

        {streaming ? (
          <button
            onClick={onStop}
            className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-ink-800 text-ink-100 transition hover:bg-ink-700 dark:bg-ink-700 dark:hover:bg-ink-600"
            aria-label="Hentikan generasi"
            title="Hentikan generasi"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            onClick={() => void handleSend()}
            disabled={disabled || (!value.trim() && attachments.length === 0)}
            className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-accent-500 text-white transition hover:bg-accent-600 disabled:opacity-40"
            aria-label="Kirim pesan"
            title="Kirim"
          >
            <SendIcon />
          </button>
        )}
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-ink-400 dark:text-ink-500">
        Riwayat disimpan di perangkat ini (IndexedDB). File besar diunggah ke storage privat Anda.
        {props.fileMap.size > 0 ? " " : ""}
      </p>
    </div>
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Gagal membaca file."));
    reader.readAsDataURL(blob);
  });
}
