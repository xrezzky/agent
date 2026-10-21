"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import Composer from "@/components/Composer";
import MessageRow from "@/components/Message";
import ModelPicker from "@/components/ModelPicker";
import SettingsModal from "@/components/SettingsModal";
import CodingPanel, { type ProjectFile } from "@/components/CodingPanel";
import { MenuIcon, PlusIcon, CodeIcon } from "@/components/icons";
import {
  listConversations,
  saveConversation,
  deleteConversation as idbDelete,
  createConversation,
  newId,
} from "@/lib/idb";
import { runChat, buildFilePayload } from "@/lib/api-client";
import { MAX_CONTEXT_CHARS } from "@/lib/constants";
import { scanZipFile, summarizeZip, extOf, classifyFile } from "@/lib/files";
import type { AttachmentMeta, ChatMessage, Conversation, ModelChoice } from "@/lib/types";

export default function Page() {
  /* ---------------------------- State utama ---------------------------- */
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelChoice, setModelChoice] = useState<ModelChoice>({ mode: "auto" });
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [fileMap, setFileMap] = useState<Map<string, File>>(new Map());
  const [streamingText, setStreamingText] = useState("");
  const [streamingModel, setStreamingModel] = useState<string | null>(null);
  const [streamingNote, setStreamingNote] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<{
    openrouter: boolean;
    storage: boolean;
    maxUploadMb: number | null;
  } | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [zipNote, setZipNote] = useState<string | null>(null);
  const [zipLoading, setZipLoading] = useState(false);
  const [codingPanelOpen, setCodingPanelOpen] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const mode = active?.mode ?? "chat";

  /* ------------------------------ Pemuatan ------------------------------ */
  useEffect(() => {
    (async () => {
      const list = await listConversations();
      setConversations(list);
      try {
        const last = localStorage.getItem("pa-last-conv");
        const mc = localStorage.getItem("pa-model-choice");
        if (mc) {
          setModelChoice(JSON.parse(mc) as ModelChoice);
        }
        if (last && list.some((c) => c.id === last)) {
          restoreDraft(list.find((c) => c.id === last)!);
        } else if (list.length > 0) {
          restoreDraft([...list].sort((a, b) => b.updatedAt - a.updatedAt)[0]);
        }
      } catch {
        /* itemId korup —abaikan */
      }
      fetch("/api/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setStatus(d))
        .catch(() => setStatus(null));
      setReady(true);
    })();
  }, []);

  /** Pulihkan draft & lampiran sesi terakhir dari percakapan terpilih. */
  function restoreDraft(conv: Conversation) {
    setActiveId(conv.id);
    localStorage.setItem("pa-last-conv", conv.id);
    setDraft(conv.draft ?? "");
    setAttachments([]);
    setFileMap(new Map());
  }

  /* ---------------------------- Pembaruan IDB ---------------------------- */
  const persist = useCallback((conv: Conversation) => {
    void saveConversation(conv);
  }, []);

  useEffect(() => {
    if (activeId && ready && draft !== (active?.draft ?? "")) {
      /* simpan draft saat mengetik (debounced ringan via effect) */
      const t = setTimeout(() => {
        setConversations((prev) => {
          const next = prev.map((c) =>
            c.id === activeId ? { ...c, draft, updatedAt: c.updatedAt } : c
          );
          const conv = next.find((c) => c.id === activeId);
          if (conv) persist(conv);
          return next;
        });
      }, 600);
      return () => clearTimeout(t);
    }
  }, [draft, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------ Aksi UI ------------------------------ */
  function toggleSidebar() {
    setSidebarOpen((v) => !v);
  }

  function startNew(modeKind: "chat" | "coding") {
    const conv = createConversation(modeKind);
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    localStorage.setItem("pa-last-conv", conv.id);
    setDraft("");
    setAttachments([]);
    setFileMap(new Map());
    setStreamingText("");
    if (modeKind === "coding") {
      setProjectFiles([]);
      setZipNote(null);
      setCodingPanelOpen(true);
    }
    setSidebarOpen(false);
    void persist(conv);
  }

  function switchConversation(id: string) {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    // Simpan draft percakapan saat ini dulu.
    setConversations((prev) => {
      const next = prev.map((c) => (c.id === activeId ? { ...c, draft } : c));
      const cur = next.find((c) => c.id === activeId);
      if (cur) persist(cur);
      return next;
    });
    restoreDraft(conv);
    setStreamingText("");
    setSidebarOpen(false);
    if (conv.mode !== "coding") {
      setProjectFiles([]);
    }
  }

  function renameConversation(id: string, title: string) {
    setConversations((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, title, updatedAt: Date.now() } : c));
      const conv = next.find((c) => c.id === id);
      if (conv) persist(conv);
      return next;
    });
  }

  function removeConversation(id: string) {
    void idbDelete(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) {
      const rest = conversations.filter((c) => c.id !== id);
      if (rest.length > 0) restoreDraft([...rest].sort((a, b) => b.updatedAt - a.updatedAt)[0]);
      else {
        const conv = createConversation(mode);
        setConversations([conv]);
        setActiveId(conv.id);
        void persist(conv);
      }
    }
  }

  /* ----------------------------- Kirim chat ----------------------------- */
  async function send(text: string, sentAttachments: AttachmentMeta[]) {
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv || isStreaming) return;

    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      content: text,
      createdAt: Date.now(),
      attachments: sentAttachments.length ? sentAttachments : undefined,
    };

    const isFirstExchange = conv.messages.length === 0;
    const updated: Conversation = {
      ...conv,
      title:
        isFirstExchange && conv.title === "Percakapan baru"
          ? text.slice(0, 48) || "Percakapan baru"
          : conv.title,
      draft: "",
      updatedAt: Date.now(),
      messages: [...conv.messages, userMessage],
    };

    setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    void persist(updated);
    setDraft("");
    setAttachments([]);
    setFileMap(new Map());

    await generate(updated, false);
  }

  async function regenerate(convId: string) {
    const conv = conversations.find((c) => c.id === convId);
    if (!conv || isStreaming) return;
    // Buang pesan assistant terakhir lalu ulangi.
    const msgs = [...conv.messages];
    while (msgs.length && msgs[msgs.length - 1].role === "assistant") msgs.pop();
    if (msgs.length === 0) return;
    const updated = { ...conv, messages: msgs, updatedAt: Date.now() };
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    void persist(updated);
    await generate(updated, false);
  }

  async function generate(conv: Conversation, isRetry: boolean) {
    void isRetry;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);
    setStreamingText("");
    setStreamingModel(null);
    setStreamingNote(null);

    // Riwayat yang dikirim: hanya pesan utuh, tanpa placeholder error.
    const history = conv.messages
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const files = await buildAllFiles(sentAttachmentsOf(conv));

    const assistantId = newId();
    let streamed = "";

    await runChat({
      messages: history,
      modelChoice,
      mode: conv.mode,
      buildFiles: async () => files,
      signal: controller.signal,
      onMeta: (model, note) => {
        setStreamingModel(model);
        setStreamingNote(note ?? null);
      },
      onDelta: (t) => {
        streamed += t;
        setStreamingText(streamed);
      },
      onDone: ({ text, model, note }) => {
        finishAssistant(conv.id, assistantId, {
          finalText: text || streamed,
          model: model || streamingModel || "auto",
          note,
          stopped: (text || streamed) === "",
        });
      },
      onError: (msg, code) => {
        setErrMessage(conv.id, assistantId, msg, code);
      },
    });

    setIsStreaming(false);
    abortRef.current = null;
  }

  /** Gabungkan konteks lampiran + proyek coding jadi payload file. */
  async function buildAllFiles(attList: AttachmentMeta[]) {
    const parts = await buildFilePayload(attList, fileMap, MAX_CONTEXT_CHARS);
    if (mode === "coding" && projectFiles.length > 0) {
      let budget = MAX_CONTEXT_CHARS - parts.reduce((s, p) => s + (p.text?.length ?? 0), 0);
      const projectPart = projectFiles
        .filter((f) => classifyFile(f.path, "") === "text" && f.text.trim())
        .map((f) => ({ name: f.path, type: extOf(f.path) || "text/plain", text: f.text }));
      for (const p of projectPart) {
        if (budget <= 0) {
          parts.push({ name: p.name, type: p.type });
          continue;
        }
        const slice = p.text.slice(0, budget);
        budget -= slice.length;
        parts.push({ name: p.name, type: p.type, text: slice });
      }
    }
    return parts;
  }

  function sentAttachmentsOf(conv: Conversation): AttachmentMeta[] {
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      if (m.role === "user" && m.attachments) return m.attachments;
    }
    return [];
  }

  function finishAssistant(
    convId: string,
    assistantId: string,
    info: { finalText: string; model: string; note?: string; stopped: boolean }
  ) {
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        const assistant: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: info.finalText,
          createdAt: Date.now(),
          model: info.model,
          note: info.note,
          stopped: info.stopped,
        };
        const updated = { ...c, messages: [...c.messages, assistant], updatedAt: Date.now() };
        void persist(updated);
        return updated;
      });
      return next;
    });
    setStreamingText("");
    setStreamingModel(null);
  }

  function setErrMessage(convId: string, assistantId: string, msg: string, code?: string) {
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        const lastMsg = c.messages[c.messages.length - 1];
        // Placeholder error hanya dibuat bila belum ada pesan assistant.
        if (lastMsg?.role === "assistant") {
          const updated: Conversation = {
            ...c,
            messages: [
              ...c.messages.slice(0, -1),
              { ...lastMsg, error: lastMsg.error ? `${lastMsg.error}\n${msg}` : msg },
            ],
            updatedAt: Date.now(),
          };
          void persist(updated);
          return updated;
        }
        const assistant: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          error: msg,
        };
        const updated: Conversation = { ...c, messages: [...c.messages, assistant], updatedAt: Date.now() };
        void persist(updated);
        return updated;
      });
      return next;
    });
    void code;
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  /* ------------------------------ Upload ZIP ------------------------------ */
  async function uploadZip(file: File) {
    setZipLoading(true);
    setZipNote(null);
    try {
      const scan = await scanZipFile(file);
      const files: ProjectFile[] = scan.textFiles.map((f) => ({ path: f.path, text: f.text }));
      setProjectFiles(files);
      const skipped = scan.entries.filter((e) => e.skipped).length;
      setZipNote(
        `${summarizeZip(scan)}` +
          (skipped ? ` • ${skipped} entri dilewati untuk keamanan/keamanan ukuran.` : "")
      );
    } catch (err) {
      setZipNote(err instanceof Error ? err.message : "ZIP tidak dapat dibaca.");
      setProjectFiles([]);
    } finally {
      setZipLoading(false);
    }
  }

  /* ------------------------------- Scroll ------------------------------- */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: isStreaming ? "auto" : "smooth" });
  }, [active?.messages.length, streamingText, isStreaming]);

  /* -------------------------------- Render -------------------------------- */
  const messages = active?.messages ?? [];

  return (
    <div className="flex h-screen overflow-hidden md:pl-0" style={{ contain: "layout" }}>
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversations={conversations}
        activeId={activeId}
        mode={mode}
        onNewConversation={() => startNew(mode)}
        onSelect={switchConversation}
        onRename={renameConversation}
        onDelete={removeConversation}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between gap-2 border-b border-ink-200 bg-white px-3 py-2 dark:border-ink-800 dark:bg-ink-950 md:px-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              onClick={toggleSidebar}
              className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 md:hidden dark:hover:bg-ink-850"
              aria-label="Buka panel percakapan"
            >
              <MenuIcon />
            </button>
            <button
              onClick={() => startNew(mode)}
              className="hidden rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 md:block dark:hover:bg-ink-850"
              aria-label="Percakapan baru"
              title="Percakapan baru"
            >
              <PlusIcon />
            </button>
            <h1 className="min-w-0 truncate text-sm font-medium">
              {active?.title ?? "AI Pribadi"}
            </h1>
            {mode === "coding" && (
              <button
                onClick={() => setCodingPanelOpen((v) => !v)}
                className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition ${
                  codingPanelOpen
                    ? "bg-accent-500/10 text-accent-600 dark:text-accent-300"
                    : "bg-ink-100 text-ink-400 dark:bg-ink-800"
                } lg:relative lg:mt-0`}
                title="Buka/tutup panel proyek"
              >
                <CodeIcon /> Coding
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ModelPicker choice={modelChoice} onChange={(c) => {
              setModelChoice(c);
              try {
                localStorage.setItem("pa-model-choice", JSON.stringify(c));
              } catch {
                /* abaikan */
              }
            }} />
          </div>
        </header>

        {mode === "coding" && (
          <CodingPanel
            files={projectFiles}
            summary={projectFiles.length ? summarizeShort() : null}
            onUpload={(f) => void uploadZip(f)}
            onClose={() => {
              setProjectFiles([]);
              setZipNote(null);
            }}
            loadingZip={zipLoading}
            zipNote={zipNote}
          />
        )}

        {/* Konten: panel coding + percakapan berdampingan */}
        <div className="flex min-h-0 flex-1 flex-row-reverse">
          {mode === "coding" && (
            <div className={`${codingPanelOpen ? "flex" : "hidden"} min-h-0 flex-1 lg:relative lg:flex lg:w-96 lg:flex-none`}>
              <CodingPanel
                files={projectFiles}
                summary={projectFiles.length ? summarizeShort() : null}
                onUpload={(f) => void uploadZip(f)}
                onClose={() => setCodingPanelOpen(false)}
                loadingZip={zipLoading}
                zipNote={zipNote}
              />
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Area percakapan */}
            <div className="min-h-0 flex-1 overflow-y-auto" id="chat-scroll">
              <div className="mx-auto w-full max-w-3xl px-4 pb-6 pt-6">
                {messages.length === 0 && !isStreaming ? (
                  <Welcome mode={mode} onPick={(t) => setDraft(t)} />
                ) : (
                  <div className="space-y-5">
                    {messages.map((m, i) => (
                      <MessageRow
                        key={m.id}
                        message={m}
                        onRegenerate={
                          !isStreaming && m.role === "assistant" && i === messages.length - 1
                            ? () => active && void regenerate(active.id)
                            : undefined
                        }
                      />
                    ))}
                    {isStreaming && (
                      <MessageRow
                        message={{
                          id: "streaming",
                          role: "assistant",
                          content: streamingText,
                          createdAt: 0,
                          model: streamingModel ?? undefined,
                          note: streamingNote ?? undefined,
                        }}
                        streaming
                      />
                    )}
                  </div>
                )}
                <div ref={chatEndRef} className="h-1" />
              </div>
            </div>

            {/* Komposer */}
            <div className="border-t border-ink-200 bg-white px-3 pb-3 pt-2 dark:border-ink-800 dark:bg-ink-950 md:px-4">
              <div className="mx-auto w-full max-w-3xl">
                {status && !status.openrouter && (
                  <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    OPENROUTER_API_KEY belum diatur di server — jawaban AI belum bisa diperoleh.
                    Lihat README untuk pengaturan.
                  </p>
                )}
                <Composer
                  value={draft}
                  onChange={setDraft}
                  attachments={attachments}
                  onAttachmentsChange={setAttachments}
                  disabled={!ready || !activeId}
                  streaming={isStreaming}
                  onSend={(t, at) => void send(t, at)}
                  onStop={stopGeneration}
                  fileMap={fileMap}
                  onFileMapChange={setFileMap}
                />
              </div>
            </div>
          </div>
        </div>
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );

  function summarizeShort(): string {
    return `${projectFiles.length} file teks diindeks dari proyek yang diunggah.`;
  }
}

function Welcome({ mode, onPick }: { mode: "chat" | "coding"; onPick: (t: string) => void }) {
  const examples =
    mode === "coding"
      ? [
          "Jelaskan struktur proyek yang saya unggah.",
          "Cari kemungkinan bug di file yang terbaca.",
          "Bantu refactor fungsi yang terlalu panjang.",
          "Jelaskan arti error ini: …",
        ]
      : [
          "Ringkas artikel berikut …",
          "Bantu saya menulis rencana …",
          "Jelaskan konsep … dengan bahasa sederhana.",
          "Buat daftar langkah untuk …",
        ];
  return (
    <div className="animate-fade-in py-10 text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-3xl bg-accent-500 text-xl font-bold text-white shadow-md">
        AI
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">Halo 👋</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-500 dark:text-ink-400">
        {mode === "coding"
          ? "Mode Coding aktif. Unggah ZIP proyek melalui panel di atas, lalu tanyakan apa saja tentang kodenya."
          : "Apa yang bisa saya bantu hari ini? Lampirkan file jika perlu — jawaban mengalir secara langsung dari model pilihan Anda."}
      </p>
      <div className="mx-auto mt-6 grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {examples.map((ex) => (
          <button
            key={ex}
            onClick={() => onPick(ex)}
            className="rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-left text-sm text-ink-600 transition hover:border-accent-400 hover:text-accent-700 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-accent-500 dark:hover:text-accent-300"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
