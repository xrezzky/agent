/**
 * Tipe data yang dipakai lintas aplikasi.
 */

export type Role = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** Model yang benar-benar menghasilkan pesan assistant. */
  model?: string;
  /** Catatan failover/alasan perpindahan model, jika ada. */
  note?: string;
  /** Lampiran yang melekat pada pesan user. */
  attachments?: AttachmentMeta[];
  /** Flag apakah generasi dibatalkan oleh pengguna. */
  stopped?: boolean;
  /** Flag pesan gagal agar bisa ditandai di UI. */
  error?: string;
}

export interface AttachmentMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  /** "inline" = dibaca langsung; "s3" = ada di object storage. */
  kind: "inline" | "s3";
  /** Daftar bagian teks hasil ekstraksi (untuk teks/pdf/zip). Kalau kosong, tidak diproses. */
  processed?: boolean;
  /** Pesan bila file tidak bisa diproses (mis. biner). */
  processNote?: string;
  /** Untuk gambar: data URL yang dikirim ke model vision. */
  dataUrl?: string;
  /** Untuk s3: lokasi objek. */
  objectKey?: string;
  uploadId?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Mode default "chat" atau "coding". */
  mode: "chat" | "coding";
  messages: ChatMessage[];
  /** Draft pesan yang belum terkirim, untuk dipulihkan. */
  draft?: string;
}

/** Pemilih model: "auto" memakai rantai prioritas. */
export type ModelChoice = { mode: "auto" } | { mode: "manual"; model: string };

/** Baris NDJSON dari server chat. */
export type ChatStreamEvent =
  | { type: "meta"; model: string; note?: string }
  | { type: "delta"; text: string }
  | { type: "error"; message: string; code?: string }
  | { type: "done"; text: string; model: string; note?: string };

/** Konfigurasi status lingkungan yang aman ditampilkan ke frontend. */
export interface StatusInfo {
  openrouter: boolean;
  storage: boolean;
  maxUploadMb: number | null;
  ownerConfigured: boolean;
}
