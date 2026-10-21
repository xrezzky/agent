"use client";

import { useState } from "react";

/**
 * Halaman login pemilik. Tidak ada pendaftaran:
 * kredensial pemilik dibaca dari environment variable di server.
 */
export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Gagal masuk. Periksa konfigurasi server.");
    } catch {
      setError("Tidak dapat menghubungi server. Periksa koneksi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-500 text-lg font-bold text-white shadow-sm">
            AI
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Masuk ke AI Pribadi</h1>
          <p className="mt-1.5 text-sm text-ink-500 dark:text-ink-400">
            Hanya pemilik yang memiliki akses. Tidak ada pendaftaran publik.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-3.5 rounded-2xl border border-ink-200 bg-white p-5 shadow-sm dark:border-ink-800 dark:bg-ink-850"
        >
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Nama pengguna</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(ev) => setUsername(ev.target.value)}
              className="w-full rounded-lg border border-ink-300 bg-transparent px-3 py-2 text-sm outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/25 dark:border-ink-700"
              required
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              className="w-full rounded-lg border border-ink-300 bg-transparent px-3 py-2 text-sm outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/25 dark:border-ink-700"
              required
            />
          </label>

          {error && (
            <p className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent-500 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-600 disabled:opacity-60"
          >
            {loading ? "Memproses…" : "Masuk"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-400 dark:text-ink-500">
          Kredensial tidak ditemukan? Atur OWNER_USERNAME, OWNER_PASSWORD_HASH,
          dan AUTH_SECRET di .env.local server.
        </p>
      </div>
    </main>
  );
}
