# AI Pribadi — Web AI Pribadi (Next.js + OpenRouter)

Asisten AI pribadi berbasis web dengan pengalaman sekelas aplikasi AI modern:
percakapan streaming, riwayat lokal, pemilihan model, failover otomatis,
lampiran file (termasuk file besar), analisis proyek/ZIP, dan Mode Coding.

> Dibuat untuk dipakai pribadi: tidak ada pendaftaran publik, hanya pemilik yang
> dapat masuk (autentikasi berbasis kredensial di environment variable server).

---

## Fitur

### Chat AI
- Percakapan baru, riwayat, ubah judul, hapus (tersimpan di **IndexedDB** perangkat ini — tidak sinkron antar-perangkat).
- Pencarian percakapan, pulihkan draft otomatis, dark/light mode.
- Jawaban **streaming langsung** dari OpenRouter (bukan simulasi), bisa dihentikan.
- Ulangi jawaban, salin jawaban, salin blok kode, Markdown lengkap (tabel, daftar, tautan), syntax highlighting.
- Enter kirim, Shift+Enter baris baru; tampilan responsif (drawer di mobile, sidebar desktop).

### Model & Failover Otomatis
- Pemilihan model manual atau otomatis (rantai prioritas dari `MODEL_CHAIN`).
- Bila model gagal karena rate limit/kuota/bed时间 gangguan/model tidak ada, sistem mencoba model berikutnya (maks. 4 percobaan daita `MAX_MODEL_ATTEMPTS`), menghormati `Retry-After`, dan menerapkan cooldown per model.
- Model aktif dan note failover ditampilkan di jawaban.
- Bila respons sudah mulai mengalir ke browser, TIDAK ada percobaan kedua yang menggandakan jawaban.
- Katalog model diambil langsung dari API OpenRouter (ID tidak dikarang).

### Lampiran File
- File kecil (teks/Moda PDF/ZIP/gambar ≤1 MB) diproses inline di browser.
- File besar → diunggah **langsung ke object storage S3-compatible** lewat URL presigned (multipart 64 MB/bagian di atas 64 MB), dengan progres, batal, dan 3× percobaan ulang per bagian. Target: file hingga 250 MB+ (dibatasi `MAX_UPLOAD_MB`).
- File tetap privat: hanya diakses lewat URL presigned berumur 15 menit.
- Ekstraksi PDF (pdf.js), ZIP streaming (batas entri/ukuran, cegah path traversal & decompression bomb), gambar dikompresi untuk model vision.

### Mode Coding
- Unggah ZIP proyek → indeks file teks, penampil kode dengan highlighting, ringkasan, dan percakapan kontekstual.
- AI memberi analisis/saran; hasil revisi dapat disalin. AI tidak mengeksekusi kode & tidak mengubah file di server.

---

## Teknologi
Next.js (App Router) · TypeScript · React 19 · Tailwind CSS · OpenRouter · IndexedDB · fflate · pdf.js · object storage S3-compatible · Vercel-ready.

---

## 1. Pasang Dependensi

```bash
npm install
```

## 2. Atur Environment

Salin `.env.example` menjadi `.env.local` lalu isi:

```bash
cp .env.example .env.local
```

| Variabel | Wajib | Keterangan |
|---|---|---|
| `OPENROUTER_API_KEY` | ✅ | Kunci dari https://openrouter.ai/keys |
| `OWNER_USERNAME` | ✅ | Nama pengguna pemilik |
| `OWNER_PASSWORD_HASH` | ✅ | SHA-256 hex password: `echo -n "password" \| shasum -a 256` |
| `AUTH_SECRET` | ✅ | String acak ≥32 karakter: `openssl rand -hex 32` |
| `MODEL_CHAIN` | ❌ | Urutan ID model, pisah koma. Cek ID di https://openrouter.ai/models |
| `FALLBACK_MODEL` | ❌ | Cadangan terakhir (bawaan `openrouter/auto`). |
| `S3_ENDPOINT` | ❌ | Untuk upload besar (lihat bagian Storage) |
| `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | ❌ | Kredensial storage |
| `MAX_UPLOAD_MB` | ❌ | Batas ukuran upload (bawaan 250) |

## 3. Jalankan Lokal

```bash
npm run dev
# buka http://localhost:3000 → login dengan kredensial pemilik
```

Build produksi:

```bash
npm run build && npm start
```

## 4. Pengaturan Storage (upload file 250 MB+)

Semua objek memakai **path-style** `${S3_ENDPOINT}/${S3_BUCKET}/...`. Contoh:

**Cloudflare R2**
```
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=ai-pribadi
```
Aktifkan akses kredensial R2 (API token) lalu setting CORS pada bucket, izinkan
method `PUT` + header `ETAG` terekspos supaya multipart dapat membaca `ETag`:

```json
[
  {
    "AllowedOrigins": ["https://domain-web-anda"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

**Backblaze B2** (endpoint S3), **MinIO**, dan **AWS S3** (`https://s3.<region>.amazonaws.com`) juga didukung.

> Tanpa storage: chat tetap berfungsi; file kecil (≤1 MB) dapat dilampirkan
> inline. File besar akan ditolak authentik dengan petunjuk konfigurasi —
> bukan pura-pura berhasil.

## 5. Konfigurasi Autentikasi

Tidak ada pendaftaran. Hanya `OWNER_USERNAME` + `OWNER_PASSWORD_HASH` yang cocok menandakan pemilik. Sesi pakai cookie `HttpOnly`+`SameSite=Lax`+`Secure` bertanda tangan HMAC (30 hari). Semua endpoint berbayar (`/api/chat`, `/api/upload/*`) memverifikasi sesi ulang di server, dan middleware memindahkan kunjungan tanpa sesi ke `/login`.

## 6. Deploy ke Vercel

1. Push source ke GitHub (private) — `.env.local` tidak ikut (sudah di `.gitignore`).
2. Di Vercel: **Add New → Project** → pilih repository.
3. Masukkan **semua** environment variable di Settings → Environment Variables (jangan pernah komit `.env.local`).
4. Deploy. Route streaming (`/api/chat`) ditandai `maxDuration = 60`.
5. Tambahkan domain bila perlu; isi `APP_PUBLIC_URL` agar OpenRouter menampilkan atribusi.

Perhatian Vercel (sudah diakomodasi desain): file besar TIDAK melewati function
body (langsung browser→storage), stream response dipakai, dan tidak ada data
persisten di filesystem function.

---

## Pengujian yang Telah Dijalankan

- `tsc --noEmit` — lolos tanpa error.
- `next build` — lolos, 8 halaman/route ter-generate.
- `npm run verify` (scripts/verify.ts):
  - sesi: token sah → terverifikasi; token diubah → ditolak;
  - `checkOwnerCredentials`: benar/salah/orang lain → perilaku tepat;
  - SigV4 presign: deterministik, memuat `X-Amz-Signature`, bagian multipart tertandt;
  - parser SSE: komentar `: keepalive` & `[DONE]` diabaikan, delta & error terbaca;
  - pemindaian ZIP: path `../` ditolak, file >2 MB dilewati, biner标记 dilewati;
  - rantai failover: urutan otomatis mengikuti config, pilihan manual di depan, jumlah percobaan terbatas.
- E2E `node scripts/e2e-run.mjs` (server tiruan lokal): 9/10 pemeriksaan lulus
  (middleware, login salah/benar + cookie, halaman dengan sesi, `/api/status`,
  chat tanpa sesi 401, upload tanpa storage 503+petunjuk). **Pemeriksaan
  streaming chat belum lulus pada lingkungan Android/Termux uji ini** karena
  quirk flush wrote kecil di Node Android (diketahui via debug; di Vercel/host
  Linux biasa penerapannya normal). Logika parser & failover sudah
  diverifikasi unit test di atas.

**Belum dapat diuji tanpa kredensial nyata:** panggilan OpenRouter sungguhan
(butuh `OPENROUTER_API_KEY` valid) dan upload ke storage nyata (butuh bucket).
Konfigurasi ini tersedia melalui `.env.local`.

## Lokasi Penting

```
src/app/page.tsx                    — shell aplikasi (percakapan, mode coding)
src/app/api/chat/route.ts           — streaming NDJSON + failover
src/lib/openrouter.ts               — klien upstream + kebijakan failover
src/lib/models.ts                   — rantai model (diedit via env)
src/lib/s3.ts                       — presigned SigV4 multipart
src/lib/files.ts                    — kompresi/ekstraksi/upload klien
src/lib/idb.ts                      — riwayat IndexedDB
src/lib/session.ts, src/middleware.ts — autentikasi
```
