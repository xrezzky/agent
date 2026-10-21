"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon } from "./icons";
import type { ModelChoice } from "@/lib/types";

interface CatalogModel {
  id: string;
  label: string;
  vision: boolean | null;
}

interface Props {
  choice: ModelChoice;
  onChange: (c: ModelChoice) => void;
  disabled?: boolean;
}

/**
 * Pemilih model: "Otomatis (rantai prioritas)" atau ID model asli
 * yang diambil dari katalog OpenRouter.
 */
export default function ModelPicker({ choice, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<{ id: string; label: string }[]>([]);
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!alive) return;
        setConfigured(data.configured ?? []);
        setCatalog(data.catalog ?? []);
        setCatalogError(data.catalogError ?? null);
      })
      .catch(() => {
        if (alive) setCatalogError("Katalog model tidak dapat dimuat.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const manualList = useMemo(() => {
    if (catalog.length > 0) {
      const q = query.trim().toLowerCase();
      const list = q
        ? catalog.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
        : catalog;
      return list.slice(0, 400).map((m) => ({ id: m.id, label: m.label }));
    }
    return configured.map((m) => ({ id: m.id, label: m.label }));
  }, [catalog, configured, query]);

  const label =
    choice.mode === "auto"
      ? "Model otomatis"
      : shorten(choice.model);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-xl border border-ink-200 px-2.5 py-1.5 text-xs font-medium transition hover:bg-ink-100 dark:border-ink-800 dark:hover:bg-ink-850"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {choice.mode === "auto" && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent-500 text-[9px] font-bold text-white">
            A
          </span>
        )}
        <span className="max-w-[190px] truncate">{label}</span>
        <ChevronDownIcon />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="absolute bottom-full left-0 z-50 mb-2 w-80 max-h-96 overflow-y-auto rounded-2xl border border-ink-200 bg-white p-2 shadow-xl dark:border-ink-800 dark:bg-ink-900"
            role="listbox"
          >
            <button
              onClick={() => {
                onChange({ mode: "auto" });
                setOpen(false);
              }}
              className={`flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-850 ${
                choice.mode === "auto" ? "bg-accent-500/10 dark:bg-accent-500/10" : ""
              }`}
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500 text-[10px] font-bold text-white">
                A
              </span>
              <span>
                <strong className="block">Model otomatis</strong>
                <span className="text-xs text-ink-400 dark:text-ink-500">
                  Menjalankan rantai prioritas dengan failover bila model gagal.
                </span>
              </span>
            </button>

            <div className="my-1.5 border-t border-ink-200 dark:border-ink-800" />

            {catalog.length > 0 && (
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari model…"
                className="mb-1.5 w-full rounded-lg border border-ink-200 bg-transparent px-2.5 py-1.5 text-xs outline-none focus:border-accent-500 dark:border-ink-800"
              />
            )}

            {manualList.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  onChange({ mode: "manual", model: m.id });
                  setOpen(false);
                }}
                className={`flex w-full flex-col rounded-lg px-3 py-1.5 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-850 ${
                  choice.mode === "manual" && choice.model === m.id ? "text-accent-600 dark:text-accent-300" : ""
                }`}
              >
                <span className="truncate">{m.label}</span>
                <span className="truncate text-[10px] font-mono text-ink-400 dark:text-ink-500">{m.id}</span>
              </button>
            ))}

            <p className="px-3 py-2 text-[10px] leading-relaxed text-ink-400 dark:text-ink-500">
              {catalogError ? (
                catalogError + " Rantai prioritas dari konfigurasi server tetap dapat dipilih."
              ) : (
                <>
                  ID diambil langsung dari daftar model OpenRouter. Ubah urutan prioritas lewat MODEL_CHAIN di
                  .env.local.
                </>
              )}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function shorten(id: string): string {
  const idx = id.lastIndexOf("/");
  return idx > 0 ? id.slice(idx + 1) : id;
}
