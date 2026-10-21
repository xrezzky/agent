"use client";

import { useMemo, useState } from "react";
import type { Conversation } from "@/lib/types";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeId: string | null;
  mode: "chat" | "coding";
  onNewConversation: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
}

/** Sidebar: percakapan baru, pencarian, riwayat, mode coding, pengaturan. */
export default function Sidebar(props: SidebarProps) {
  const {
    open,
    onClose,
    conversations,
    activeId,
    mode,
    onNewConversation,
    onSelect,
    onRename,
    onDelete,
    onOpenSettings,
  } = props;
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!q) return sorted;
    return sorted.filter(
      (c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [conversations, query]);

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} aria-hidden />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-ink-200 bg-white transition-transform duration-200 ease-out md:sticky md:top-0 md:h-screen md:translate-x-0 dark:border-ink-800 dark:bg-ink-950 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Panel percakapan"
      >
        <div className="flex items-center justify-between px-3 pt-3">
          <div className="flex items-center gap-2 px-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-500 text-xs font-bold text-white">
              AI
            </div>
            <span className="text-sm font-semibold tracking-tight">AI Pribadi</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 md:hidden dark:hover:bg-ink-800"
            aria-label="Tutup panel"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 px-3">
          <button
            onClick={onNewConversation}
            className="w-full rounded-xl border border-ink-200 px-3 py-2 text-left text-sm font-medium transition hover:bg-ink-100 dark:border-ink-800 dark:hover:bg-ink-850"
          >
            <span className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-500">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              Percakapan baru
            </span>
          </button>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari percakapan…"
            className="mt-2 w-full rounded-xl border border-ink-200 bg-transparent px-3 py-2 text-sm outline-none transition focus:border-accent-500 dark:border-ink-800"
          />
        </div>

        <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-ink-400 dark:text-ink-500">
              {query ? "Tidak ada percakapan yang cocok." : "Belum ada percakapan."}
            </p>
          )}
          {filtered.map((conv) => (
            <ConversationRow
              key={conv.id}
              conv={conv}
              active={conv.id === activeId}
              onSelect={() => onSelect(conv.id)}
              onRename={(t) => onRename(conv.id, t)}
              onDelete={() => onDelete(conv.id)}
            />
          ))}
        </nav>

        <div className="border-t border-ink-200 p-2 dark:border-ink-800">
            <button
              onClick={onOpenSettings}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition hover:bg-ink-100 dark:hover:bg-ink-850"
            >
              <GearIcon />
              Pengaturan
            </button>
        </div>
      </aside>
    </>
  );
}

function ConversationRow({
  conv,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  conv: Conversation;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conv.title);

  return (
    <div
      className={`group relative flex items-center rounded-xl px-2.5 py-2 text-sm transition ${
        active
          ? "bg-accent-500/10 text-accent-700 dark:text-accent-300"
          : "hover:bg-ink-100 dark:hover:bg-ink-850"
      }`}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(conv.title);
              setEditing(false);
            }
          }}
          className="w-full rounded-md bg-transparent outline-none ring-1 ring-accent-500/50"
        />
      ) : (
        <>
          <button onClick={onSelect} className="min-w-0 flex-1 truncate text-left">
            {conv.mode === "coding" && <span className="mr-1 text-[10px] text-ink-400">{'</>'}</span>}
            {conv.title}
          </button>
          <div className="absolute right-1.5 hidden gap-0.5 group-hover:flex">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDraft(conv.title);
                setEditing(true);
              }}
              className="rounded-md bg-white/80 p-1 text-ink-400 hover:text-ink-700 dark:bg-ink-850/80 dark:hover:text-ink-200"
              aria-label={`Ubah judul "${conv.title}"`}
              title="Ubah judul"
            >
              <PencilIcon />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Hapus percakapan "${conv.title}"?`)) onDelete();
              }}
              className="rounded-md bg-white/80 p-1 text-ink-400 hover:text-red-500 dark:bg-ink-850/80"
              aria-label={`Hapus percakapan "${conv.title}"`}
              title="Hapus"
            >
              <TrashIcon />
            </button>
          </div>
        </>
      )}
    </div>
  );

  function commit() {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== conv.title) onRename(t);
  }
}

const PencilIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const GearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.02.03a2 2 0 1 1-2.83 2.83l-.02-.02a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.02.02a2 2 0 1 1-2.83-2.83l.02-.02A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.87l-.02-.02a2 2 0 1 1 2.83-2.83l.02.02A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.08 4.6a1.7 1.7 0 0 0 1.87-.34l.02-.02a2 2 0 1 1 2.83 2.83l-.02.02A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" strokeLinejoin="round" />
  </svg>
);

const CodeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m8 15-4-3 4-3M16 9l4 3-4 3M14 5l-4 14" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
