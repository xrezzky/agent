/**
 * Konstanta global aplikasi.
 */

export const SESSION_COOKIE = "pa_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 hari

/** Batas aman karakter konteks file yang ikut dikirim ke model per permintaan. */
export const MAX_CONTEXT_CHARS = 150_000;

/** Batas ukuran lampiran inline (dikirim langsung dalam body chat), byte. */
export const MAX_INLINE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Batas jumlah file ketika mengekstrak arsip ZIP. */
export const MAX_ZIP_ENTRIES = 5_000;

/** Batas total ukuran hasil ekstraksi ZIP, byte. */
export const MAX_ZIP_TOTAL_BYTES = 300 * 1024 * 1024;

/** Batas ukuran satu file dalam ZIP yang otomatis dibaca sebagai teks, byte. */
export const MAX_ZIP_TEXT_FILE_BYTES = 2 * 1024 * 1024;

/** Jumlah maksimum percobaan model dalam satu permintaan chat. */
export const MAX_MODEL_ATTEMPTS = 4;
