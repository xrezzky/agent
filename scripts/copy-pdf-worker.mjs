/**
 * Menyalin worker pdf.js ke folder public pada waktu build/dev.
 * Ini memudahkan pratinjau PDF di sisi perangkat tanpa CDN.
 */
import fsM from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = path.join(root, "public", "pdf.worker.min.mjs");

try {
  fsM.mkdirSync(path.join(root, "public"), { recursive: true });
  if (fsM.existsSync(src)) {
    if (!fsM.existsSync(dest)) {
      fsM.copyFileSync(src, dest);
    }
    console.info("[copy-pdf-worker] siap");
  } else {
    console.warn(
      "[copy-pdf-worker] pdfjs-dist tidak ditemukan; PDF tidak akan dapat dibaca di browser."
    );
  }
} catch (e) {
  console.warn("[copy-pdf-worker] menampilkan keterangan:", e);
}
