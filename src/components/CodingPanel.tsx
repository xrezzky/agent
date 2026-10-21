"use client";

import { useMemo, useState } from "react";
import { FolderIcon, UploadIcon, XIcon } from "./icons";

export interface ProjectFile {
  path: string;
  text: string;
}

/**
 * Panel Mode Coding: daftar file proyek, penampil kode dengan
 * syntax highlighting, tombol salin, dan ringkasan analisis.
 * AI menghasilkan USULAN perubahan; file tidak diubah di server.
 */
export default function CodingPanel({
  files,
  summary,
  onUpload,
  onClose,
  loadingZip,
  zipNote,
}: {
  files: ProjectFile[];
  summary: string | null;
  onUpload: (file: File) => void;
  onClose: () => void;
  loadingZip: boolean;
  zipNote: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const paths = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? files.map((f) => f.path).filter((p) => p.toLowerCase().includes(q)) : files.map((f) => f.path);
  }, [files, filter]);

  const active = selected ?? paths[0] ?? null;
  const activeFile = files.find((f) => f.path === active) ?? null;
  const lang = active ? guessLanguage(active) : "";

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-b border-ink-200 bg-white lg:w-96 lg:border-b-0 lg:border-r dark:border-ink-800 dark:bg-ink-950">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2 dark:border-ink-800">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <FolderIcon />
          Proyek ({files.length})
        </span>
        <button onClick={onClose} className="rounded-md p-1 text-ink-400 hover:text-ink-700 dark:hover:text-ink-200" title="Tutup panel coding">
          <XIcon />
        </button>
      </div>

      <label className="m-2.5 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 px-3 py-2.5 text-xs text-ink-500 transition hover:border-accent-500 hover:text-accent-600 dark:border-ink-700 dark:text-ink-400">
        <input
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
        <UploadIcon />
        {loadingZip ? "Membaca ZIP…" : "Unggah proyek (.ZIP) — diproses di perangkat ini"}
      </label>

      {zipNote && (
        <p className="mx-2.5 mb-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {zipNote}
        </p>
      )}

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Cari nama file…"
        className="mx-2.5 mb-2 w-auto rounded-lg border border-ink-200 bg-transparent px-2.5 py-1.5 text-xs outline-none focus:border-accent-500 dark:border-ink-800"
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {summary && (
          <details className="mx-1.5 mb-2 rounded-lg bg-ink-100 px-2.5 py-2 text-[11px] leading-relaxed text-ink-600 dark:bg-ink-850 dark:text-ink-300">
            <summary className="cursor-pointer font-medium">Ringkasan struktur</summary>
            <pre className="mt-1.5 whitespace-pre-wrap font-mono">{summary}</pre>
          </details>
        )}
        {!files.length && !loadingZip && (
          <p className="px-3 py-6 text-center text-[11px] text-ink-400 dark:text-ink-500">
            Belum ada proyek. Unggah ZIP untuk mulai menganalisis.
          </p>
        )}
        {paths.map((p) => (
          <button
            key={p}
            onClick={() => setSelected(p)}
            className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
              p === active
                ? "bg-accent-500/10 text-accent-700 dark:text-accent-300"
                : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-850"
            }`}
            title={p}
          >
            {p}
          </button>
        ))}
      </div>

      {activeFile && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-ink-200 dark:border-ink-800">
          <div className="flex items-center justify-between border-b border-ink-200 px-2.5 py-1.5 dark:border-ink-800">
            <span className="min-w-0 flex-1 truncate text-[10px] font-mono text-ink-400">{active}</span>
            <CopyTextButton text={activeFile.text} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-ink-50 p-2 dark:bg-ink-900">
            <pre className="!m-0">
              <code className={`hljs language-${lang}`}>{activeFile.text.slice(0, 400_000)}</code>
            </pre>
          </div>
        </div>
      )}
    </aside>
  );
}

function CopyTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="rounded-md px-1.5 py-1 text-[11px] text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-850 dark:hover:text-ink-200"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* abaikan */
        }
      }}
    >
      {copied ? "Tersalin ✓" : "Salin"}
    </button>
  );
}

function guessLanguage(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin",
    swift: "swift", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp",
    php: "php", sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell",
    sql: "sql", html: "html", htm: "html", css: "css", scss: "scss", less: "less",
    json: "json", yml: "yaml", yaml: "yaml", xml: "xml", md: "markdown",
    toml: "ini", ini: "ini", env: "ini", dart: "dart", vue: "html", svelte: "html",
  };
  return map[ext] ?? "plaintext";
}
