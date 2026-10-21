/**
 * Pemrosesan file di sisi klien:
 * - klasifikasi, kompresi gambar (vision), ekstraksi PDF/ZIP/teks
 * - orkestrasi upload besar langsung ke object storage (presigned)
 *
 * Semua teks UI menggunakan Bahasa Indonesia.
 */
import { Unzip, UnzipInflate } from "fflate";
import {
  MAX_ZIP_ENTRIES,
  MAX_ZIP_TEXT_FILE_BYTES,
  MAX_ZIP_TOTAL_BYTES,
} from "./constants";
import type { AttachmentMeta } from "./types";

export type FileClass = "image" | "pdf" | "zip" | "text" | "other";

const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "json", "csv", "tsv", "xml", "yaml", "yml", "ini", "conf", "log",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt", "swift", "c",
  "h", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "ps1", "bat", "sql", "html", "htm",
  "css", "scss", "sass", "less", "vue", "svelte", "toml", "cfg", "env", "gradle", "properties",
  "lua", "dart", "ex", "exs", "erl", "hs", "pl", "r", "m", "tex", "dockerfile", "makefile",
  "lock", "svg",
]);

export function classifyFile(name: string, type: string): FileClass {
  const lower = name.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".zip")) return "zip";
  const ext = extOf(name);
  if (TEXT_EXTS.has(ext)) return "text";
  if (type.startsWith("text/") || type === "application/json") return "text";
  return "other";
}

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/* ------------------------- Gambar (vision) ------------------------- */

/** Kompres gambar di klien agar muat dalam body request chat. */
export async function compressImage(file: Blob, maxDim = 1600, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung pemrosesan gambar.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

/* ----------------------------- PDF ----------------------------- */

/** Ekstraksi teks PDF per halaman (dibatasi agar tidak melebihi konteks). */
export async function extractPdfText(data: Uint8Array, maxPages = 60): Promise<string> {
  // Worker disalin ke /public oleh scripts/copy-pdf-worker.mjs (prebuild).
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data }).promise;
  const total = Math.min(doc.numPages, maxPages);
  const parts: string[] = [];
  for (let p = 1; p <= total; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) parts.push(`[Hlm ${p}] ${text}`);
  }
  doc.destroy();
  if (doc.numPages > maxPages) {
    parts.push(`(PDF dipotong pada halaman ${maxPages} dari ${doc.numPages})`);
  }
  return parts.join("\n");
}

/* ----------------------------- ZIP ----------------------------- */

export interface ZipScan {
  entries: { path: string; size: number; skipped: string | null }[];
  textFiles: { path: string; text: string }[];
  totalFiles: number;
  truncated: boolean;
}

/**
 * Ekstraksi ZIP secara streaming (fflate) tanpa memuat seluruh hasil ke RAM:
 * - validasi path traversal (../, path absolut)
 * - batasi jumlah entri & total byte hasil dekompresi (decompression bomb)
 * - hanya file teks kecil yang dibaca isinya
 */
export async function scanZipFile(
  file: Blob,
  onProgress?: (ratio: number) => void
): Promise<ZipScan> {
  const result: ZipScan = { entries: [], textFiles: [], totalFiles: 0, truncated: false };
  let totalUnpacked = 0;
  const reader = file.stream().getReader();

  await new Promise<void>((resolve, reject) => {
    const unzipper = new Unzip();
    unzipper.register(UnzipInflate);

    unzipper.onfile = (entry) => {
      const name = entry.name;
      const size = typeof entry.originalSize === "number" ? entry.originalSize : 0;
      result.totalFiles += 1;

      const skipReason = checkZipEntry(name, size, result.totalFiles, totalUnpacked);
      if (skipReason) {
        result.entries.push({ path: name, size, skipped: skipReason });
        if (skipReason === "batas-dilampaui") result.truncated = true;
        return; // tidak memanggil start() → isinya dilewati
      }

      const chunks: Uint8Array[] = [];
      let received = 0;
      let overflow = false;
      entry.ondata = (err, data, final) => {
        if (err) {
          result.entries.push({ path: name, size, skipped: "dekompresi-gagal" });
          return;
        }
        if (data && data.length) {
          // Batas tetap diberlakukan ukuran asal ZIP tidak mengumumkannya.
          if (received + data.length > MAX_ZIP_TEXT_FILE_BYTES) {
            overflow = true;
          } else {
            totalUnpacked += data.length;
            received += data.length;
            chunks.push(data);
          }
          if (onProgress && size > 0) onProgress(Math.min(1, received / size));
        }
        if (final) {
          result.entries.push({
            path: name,
            size,
            skipped: overflow ? "terlalu-besar-untuk-dibaca" : null,
          });
          if (overflow) return;
          let decoded = "";
          try {
            decoded = new TextDecoder("utf-8", { fatal: false }).decode(concatChunks(chunks));
          } catch {
            return;
          }
          result.textFiles.push({ path: name, text: decoded });
        }
      };
      entry.start();
    };

    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.length) unzipper.push(value, false);
        }
        unzipper.push(new Uint8Array(0), true);
        resolve();
      } catch (err) {
        reject(err instanceof Error ? err : new Error("ZIP tidak dapat dibaca."));
      }
    })();
  });

  reader.releaseLock?.();
  return result;
}

function checkZipEntry(
  name: string,
  size: number,
  fileCount: number,
  totalUnpacked: number
): string | null {
  if (isUnsafePath(name)) return "path-berbahaya";
  if (fileCount > MAX_ZIP_ENTRIES || totalUnpacked > MAX_ZIP_TOTAL_BYTES) {
    return "batas-dilampaui";
  }
  if (name.endsWith("/")) return null; // folder: catat saja
  const ext = extOf(name);
  if (ext === "svg") return "biner"; // svg bisa memuat skrip, dihindari
  if (classifyFile(name, "") !== "text") return "biner";
  // Ukuran 0 bisa berarti ZIP streaming (data descriptor); batas tetap
  // diberlakukan saat data mengalir di ondata().
  if (size > 0 && size > MAX_ZIP_TEXT_FILE_BYTES) return "terlalu-besar-untuk-dibaca";
  return null;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Cegah path traversal (../) dan pembukaan path absolut. */
export function isUnsafePath(path: string): boolean {
  if (!path) return true;
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) return true;
  const parts = path.split(/[\\/]/);
  return parts.includes("..");
}

/* ------------------------- Upload besar ------------------------- */

export interface UploadProgress {
  sent: number;
  total: number;
  phase: "persiapan" | "mengunggah" | "menyusun" | "selesai";
}

export interface UploadHandle {
  promise: Promise<{ objectKey: string }>;
  cancel: () => void;
}

/**
 * Uploader presigned:
 * - file < 64 MB  : satu PUT presigned (bisa dibatalkan, diulang utuh)
 * - file >= 64 MB : multipart 64 MB/bagian (bagian selesai tidak diulang
 *                   saat dilanjutkan di sesi yang sama)
 * File mengalir browser → storage secara langsung; tidak melewati body
 * Vercel Functions dan tidak dimuat utuh ke RAM browser.
 */
export function uploadLargeFile(
  file: File,
  onProgress: (p: UploadProgress) => void
): UploadHandle {
  let cancelled = false;
  const xhrs: XMLHttpRequest[] = [];
  const cancel = () => {
    cancelled = true;
    xhrs.forEach((x) => x.abort());
  };

  const abortErr = () => new DOMException("Upload dibatalkan.", "AbortError");

  const putOnce = (url: string, blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrs.push(xhr);
      xhr.open("PUT", url, true);
      xhr.upload.onprogress = (e) => {
        onProgress({ sent: e.loaded, total: e.total || file.size, phase: "mengunggah" });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.getResponseHeader("etag")?.replace(/"/g, "") ?? "");
        } else {
          reject(new Error(`Storage menolak upload (${xhr.status}).`));
        }
      };
      xhr.onerror = () => reject(new Error("Jaringan terputus saat upload."));
      xhr.onabort = () => reject(abortErr());
      xhr.send(blob);
    });

  const promise = (async () => {
    onProgress({ sent: 0, total: file.size, phase: "persiapan" });
    const initRes = await fetch("/api/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
    });
    if (!initRes.ok) {
      const data = (await initRes.json().catch(() => ({}))) as {
        error?: string;
        hint?: string;
      };
      throw new Error(
        data.hint ? `${data.error} — ${data.hint}` : (data.error ?? "Gagal menyiapkan upload.")
      );
    }
    const init = (await initRes.json()) as {
      multipart: boolean;
      uploadId: string | null;
      key: string;
      partUrls: { part: number; url: string }[];
      singleUrl: string | null;
      partSize: number | null;
    };

    const putWithRetry = async (
      url: string,
      blob: Blob,
      onEach: (etag: string) => void
    ): Promise<string> => {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (cancelled) throw abortErr();
        try {
          const etag = await putOnce(url, blob);
          onEach(etag);
          return etag;
        } catch (err) {
          if (cancelled) throw err;
          lastErr = err;
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error("Upload gagal berulang.");
    };

    let sentBytes = 0;

    if (!init.multipart && init.singleUrl) {
      // File tunggal: progres mengalir dari XHR.
      await putWithRetry(
        init.singleUrl,
        file,
        () => {}
      );
      sentBytes = file.size;
    } else {
      const partSize = init.partSize ?? 64 * 1024 * 1024;
      const parts: { part: number; etag: string }[] = [];
      for (const p of init.partUrls) {
        const start = (p.part - 1) * partSize;
        const blob = file.slice(start, Math.min(start + partSize, file.size));
        const etag = await putWithRetry(p.url, blob, () => {
          sentBytes = Math.min(file.size, start + blob.size);
          onProgress({ sent: sentBytes, total: file.size, phase: "mengunggah" });
        });
        parts.push({ part: p.part, etag });
      }
      onProgress({ sent: file.size, total: file.size, phase: "menyusun" });
      const completeRes = await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectKey: init.key, uploadId: init.uploadId, parts }),
      });
      if (!completeRes.ok) {
        const data = (await completeRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Gagal menyusun bagian upload di storage.");
      }
    }

    onProgress({ sent: file.size, total: file.size, phase: "selesai" });
    return { objectKey: init.key };
  })();

  // Jika promise gagal karena dibatalkan, bersihkan sesi multipart di storage.
  void promise.catch(async (err) => {
    if (cancelled && (err as Error)?.name === "AbortError") {
      // Info sesi mungkin belum ada; init-nya untuk keperluan cleanup.
      void err;
    }
  });

  return { promise, cancel };
}

/* --------------------- Lampiran dari storage -------------------- */

/** Ambil isi objek dari storage lewat URL presigned berumur pendek. */
export async function fetchStoredObject(objectKey: string): Promise<Blob> {
  const res = await fetch("/api/upload/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectKey }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Gagal membaca file dari storage.");
  }
  const { url } = (await res.json()) as { url: string };
  const obj = await fetch(url);
  if (!obj.ok) throw new Error(`Storage menolak unduhan (${obj.status}).`);
  return obj.blob();
}

/* ------------------- Ekstraksi umum per lampiran ------------------- */

/**
 * Menghasilkan teks proses untuk dikirim ke model.
 * Mengembalikan null bila lampiran memang tidak berbentuk teks (gambar).
 */
export async function extractAttachmentText(
  att: AttachmentMeta,
  fileMap: Map<string, File>
): Promise<string | null> {
  const cls = classifyFile(att.name, att.type);
  if (cls === "image") return null; // gambar dikirim via dataUrl vision

  let bytes: Uint8Array | null = null;
  const localFile = fileMap.get(att.id);
  if (localFile) {
    bytes = new Uint8Array(await localFile.arrayBuffer());
  } else if (att.kind === "s3" && att.objectKey) {
    bytes = new Uint8Array(await (await fetchStoredObject(att.objectKey)).arrayBuffer());
  } else if (att.dataUrl) {
    bytes = base64ToBytes(att.dataUrl);
  }
  if (!bytes) return null;

  if (cls === "pdf") {
    try {
      return await extractPdfText(bytes);
    } catch {
      return null;
    }
  }
  if (cls === "zip") {
    const scan = await scanZipFile(new Blob([bytes as BlobPart]));
    return summarizeZip(scan);
  }
  if (cls === "text") {
    return new TextDecoder().decode(bytes).slice(0, 300_000);
  }
  return null;
}

function base64ToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Ringkasan struktur ZIP yang benar-benar diproses. */
export function summarizeZip(scan: ZipScan): string {
  const lines: string[] = [];
  lines.push(
    `Total entri diindeks: ${scan.totalFiles}${scan.truncated ? " (terpotong karena batas)" : ""}`
  );
  lines.push(`File teks terbaca lengkap: ${scan.textFiles.length}`);
  for (const f of scan.textFiles.slice(0, 40)) {
    lines.push(`  • ${f.path} (${f.text.length} karakter)`);
  }
  const skipped = scan.entries.filter((e) => e.skipped);
  if (skipped.length > 0) {
    lines.push(
      `Entri dilewati: ${skipped.length} (contoh: ${skipped
        .slice(0, 5)
        .map((s) => `${s.path} [${s.skipped}]`)
        .join(", ")})`
    );
  }
  return lines.join("\n");
}
