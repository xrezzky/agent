"use client";

import { useEffect, useState } from "react";
import { XIcon, MoonIcon, SunIcon } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  slug?: "chat" | "coding";
}

interface StatusInfo {
  openrouter: boolean;
  storage: boolean;
  maxUploadMb: number | null;
  ownerConfigured: boolean;
}

/** Modal pengaturan: tema, status konfigurasi server, logout. */
export default function SettingsModal({ open, onClose }: Props) {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDark(document.documentElement.classList.contains("dark"));
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d))
      .catch(() => setStatus(null));
  }, [open]);

  if (!open) return null;

  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle("dark");
    document.documentElement.classList.toggle("light", !isDark);
    try {
      localStorage.setItem("pa-theme", isDark ? "dark" : "light");
    } catch {
      /* abaikan */
    }
    setDark(isDark);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-5 shadow-2xl dark:border-ink-800 dark:bg-ink-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Pengaturan"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Pengaturan</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-850" aria-label="Tutup">
            <XIcon />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-ink-200 px-3.5 py-2.5 dark:border-ink-800">
            <span className="text-sm">Tampilan</span>
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium transition hover:bg-ink-100 dark:border-ink-800 dark:hover:bg-ink-850"
            >
              {dark ? <MoonIcon /> : <SunIcon />}
              {dark ? "Mode gelap" : "Mode terang"}
            </button>
          </div>

          <div className="rounded-xl border border-ink-200 px-3.5 py-3 dark:border-ink-800">
            <p className="mb-2 text-sm font-medium">Status konfigurasi server</p>
            <ul className="space-y-1.5 text-xs text-ink-500 dark:text-ink-400">
              <ServerRow
                ok={status?.openrouter ?? null}
                label="OpenRouter API key"
                hint={status?.openrouter ? "Tersambung." : "Isi OPENROUTER_API_KEY di .env.local agar chat berfungsi."}
              />
              <ServerRow
                ok={status?.storage ?? null}
                label="Storage S3-compatible"
                hint={
                  status?.storage
                    ? `Aktif. Batas upload: ${status.maxUploadMb ?? "?"} MB.`
                    : "Belum disetel. Upload file besar butuh S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY."
                }
              />
              <ServerRow
                ok={true}
                label="Autentikasi pemilik"
                hint={status?.ownerConfigured ? "Kredensial terpasang." : "Isi OWNER_USERNAME & OWNER_PASSWORD_HASH di .env.local."}
              />
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-400 dark:text-ink-500">
              Riwayat percakapan disimpan lokal (IndexedDB) di perangkat ini dan tidak
              disinkronkan ke perangkat lain.
            </p>
          </div>
        </div>

        <button
          onClick={() => void logout()}
          className="mt-4 w-full rounded-xl border border-red-300/70 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          Keluar
        </button>
      </div>
    </div>
  );
}

function ServerRow({ ok, label, hint }: { ok: boolean | null; label: string; hint: string }) {
  return (
    <li className="flex gap-2">
      <span
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
          ok === null ? "bg-ink-300" : ok ? "bg-emerald-500" : "bg-amber-500"
        }`}
        aria-hidden
      />
      <span>
        <strong className="text-ink-700 dark:text-ink-200">{label}</strong> — {hint}
      </span>
    </li>
  );
}
