/**
 * Penyimpanan riwayat percakapan sisi klien (IndexedDB).
 * Riwayat hanya ada di perangkat pemilik ini — tidak ada sinkronisasi
 * lintas perangkat.
 */

import type { Conversation } from "./types";

const DB_NAME = "web-ai-pribadi";
const DB_VERSION = 1;
const STORE = "conversations";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode: IDBTransactionMode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

export async function listConversations(): Promise<Conversation[]> {
  try {
    const store = await tx("readonly");
    return await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveConversation(conv: Conversation): Promise<void> {
  const store = await tx("readwrite");
  await new Promise<void>((resolve, reject) => {
    const req = store.put(conv);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const store = await tx("readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteConversation(id: string): Promise<void> {
  const store = await tx("readwrite");
  await new Promise<void>((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function newId(): string {
  return `${Date.now().toString(36)}-${cryptoRandom()}`;
}

function cryptoRandom(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createConversation(mode: "chat" | "coding"): Conversation {
  const now = Date.now();
  return {
    id: newId(),
    title: "Percakapan baru",
    createdAt: now,
    updatedAt: now,
    mode,
    messages: [],
  };
}
