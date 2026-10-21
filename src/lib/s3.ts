/**
 * Klien S3-compatible minimal (AWS SigV4 ditulis manual).
 *
 * Mendukung penyedia apa pun yang kompatibel S3 lewat endpoint:
 * AWS S3, Cloudflare R2, Backblaze B2, MinIO, dsb. Memakai path-style
 * (${S3_ENDPOINT}/${S3_BUCKET}/key) yang didukung penyedia umum.
 *
 * Semua tanda tangan hanya dipakai di server.
 */

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function getS3Config(): S3Config | null {
  const endpoint = (process.env.S3_ENDPOINT ?? "").replace(/\/+$/, "");
  const region = process.env.S3_REGION ?? "";
  const bucket = process.env.S3_BUCKET ?? "";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? "";
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

/* ------------------------- Crypto helpers ------------------------- */

const te = new TextEncoder();

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? te.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return toHex(new Uint8Array(digest));
}

async function hmacBytes(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, te.encode(data) as BufferSource);
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function amzDate(date: Date): { iso: string; day: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(
    date.getUTCHours()
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return { iso, day: iso.slice(0, 8) };
}

/** URI-encoding RFC3986 untuk komponen AWS (aman untuk nilai & path). */
function awsUriEncode(value: string, encodeSlash = true): string {
  return value
    .split("")
    .map((c) => {
      if (/[A-Za-z0-9\-._~]/.test(c)) return c;
      if (c === "/") return encodeSlash ? "%2F" : c;
      return Array.from(new TextEncoder().encode(c))
        .map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
        .join("");
    })
    .join("");
}

/* ----------------------- Tanda tangan SigV4 ----------------------- */

function canonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => ({
      k: awsUriEncode(k),
      v: awsUriEncode(v),
    }))
    .sort((a, b) => (a.k === b.k ? (a.v < b.v ? -1 : 1) : a.k < b.k ? -1 : 1))
    .map(({ k, v }) => `${k}=${v}`)
    .join("&");
}

export interface PresignArgs {
  method: "GET" | "PUT" | "DELETE";
  /** Kunci objek, mis. "attachments/2026/xxx-namafile.bin" */
  key: string;
  /** Query tambahan (mis. partNumber & uploadId) yang ikut ditandatangani. */
  params?: Record<string, string>;
  /** Umur tanda tangan dalam detik. */
  expires: number;
}

/** Membuat URL presigned (query tanda tangan) untuk S3-compatible. */
export async function presignObject(
  cfg: S3Config,
  { method, key, params = {}, expires, now: nowDate }: PresignArgs & { now?: Date }
): Promise<string> {
  const now = amzDate(nowDate ?? new Date());
  const scope = `${now.day}/${cfg.region}/s3/aws4_request`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
    "X-Amz-Date": now.iso,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
    ...params,
  };

  const host = new URL(cfg.endpoint).host;
  const canonicalUri =
    "/" + cfg.bucket + "/" + key.split("/").map((p) => awsUriEncode(p, false)).join("/");
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery(query),
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    now.iso,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacBytes(te.encode(`AWS4${cfg.secretAccessKey}`), now.day);
  const kRegion = await hmacBytes(kDate, cfg.region);
  const kService = await hmacBytes(kRegion, "s3");
  const kSigning = await hmacBytes(kService, "aws4_request");
  const signature = toHex(await hmacBytes(kSigning, stringToSign));

  return `${cfg.endpoint}/${cfg.bucket}/${key.split("/").map((p) => encodeURIComponent(p)).join("/")}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}

/**
 * Menandatangani request dengan header (untuk POST Multipart Init/Complete
 * dan operasi yang tidak memakai query signature).
 */
export async function signedFetch(
  cfg: S3Config,
  method: "POST" | "DELETE" | "GET",
  key: string,
  body: string,
  extraQuery: Record<string, string> = {}
): Promise<Response> {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key}`);
  for (const [k, v] of Object.entries(extraQuery)) url.searchParams.set(k, v);

  const now = amzDate(new Date());
  const scope = `${now.day}/${cfg.region}/s3/aws4_request`;
  const host = url.host;
  const payloadHash = await sha256Hex(body || "");
  const canonicalUri = "/" + cfg.bucket + "/" + key.split("/").map((p) => awsUriEncode(p, false)).join("/");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery(Object.fromEntries(url.searchParams.entries())),
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${now.iso}\n`,
    "host;x-amz-content-sha256;x-amz-date",
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    now.iso,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacBytes(te.encode(`AWS4${cfg.secretAccessKey}`), now.day);
  const kRegion = await hmacBytes(kDate, cfg.region);
  const kService = await hmacBytes(kRegion, "s3");
  const kSigning = await hmacBytes(kService, "aws4_request");
  const signature = toHex(await hmacBytes(kSigning, stringToSign));

  return fetch(url.toString(), {
    method,
    headers: {
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
        `SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": now.iso,
      "Content-Type": method === "POST" ? "application/xml" : undefined,
    } as Record<string, string>,
    body: body || undefined,
  });
}

/* ---------------------------- Helpers ---------------------------- */

export interface UploadInitResult {
  uploadId: string | null;
  key: string;
  partUrls: { part: number; url: string }[];
  singleUrl: string | null;
}

/** Menyusun kunci objek yang aman (tanpa karakter berbahaya, diawali folder). */
export function safeObjectKey(fileNameStem: string, ext: string): string {
  const stem = fileNameStem
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .replace(/^[-.]+/, "") || "file";
  const id = `${Date.now().toString(36)}-${cryptoRandom()}`;
  return `lampiran/${id}/${stem}${ext}`;
}

function cryptoRandom(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}
