/**
 * Verifikasi logika inti tanpa kredensial eksternal:
 * - sesi auth (roundtrip + deteksi tamper)
 * - kredensial pemilik
 * - SigV4 presign (determinisme + struktur parameter)
 * - parser SSE OpenRouter
 * - pemindaian ZIP (path traversal, batas) via fflate
 *
 * Jalankan: node scripts/copy-pdf-worker.mjs && tsx scripts/verify.ts
 */
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { createSessionToken, parseSessionToken, getAuthSecret } from "../src/lib/session";
import { checkOwnerCredentials, sha256Hex } from "../src/lib/auth";
import { presignObject } from "../src/lib/s3";
import { createSseParser } from "../src/lib/sse";
import { scanZipFile, isUnsafePath } from "../src/lib/files";
import { buildAttemptOrder } from "../src/lib/openrouter";

const S3_CFG = {
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "test-bucket",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

async function main() {
  process.env.AUTH_SECRET = "a".repeat(32);
  process.env.OWNER_USERNAME = "pemilik";
  process.env.OWNER_PASSWORD_HASH = sha256Hex("rahasia123");

  /* ---- Sesi auth ---- */
  const secret = getAuthSecret();
  assert.ok(secret, "AUTH_SECRET harus terbaca");
  const token = await createSessionToken("pemilik", secret);
  const payload = await parseSessionToken(token, secret);
  assert.ok(payload && payload.sub === "pemilik", "token sah harus terverifikasi");
  const tampered = token.slice(0, -4) + "AAAA";
  assert.equal(await parseSessionToken(tampered, secret), null, "token yang diubah harus ditolak");

  /* ---- Kredensial pemilik ---- */
  assert.equal(checkOwnerCredentials("pemilik", "rahasia123"), true);
  assert.equal(checkOwnerCredentials("pemilik", "salah"), false);
  assert.equal(checkOwnerCredentials("orang", "rahasia123"), false);

  /* ---- SigV4: determinisme + parameter ---- */
  process.env.S3_ENDPOINT = S3_CFG.endpoint;
  process.env.S3_REGION = S3_CFG.region;
  process.env.S3_BUCKET = S3_CFG.bucket;
  process.env.S3_ACCESS_KEY_ID = S3_CFG.accessKeyId;
  process.env.S3_SECRET_ACCESS_KEY = S3_CFG.secretAccessKey;

  const baseArgs = {
    method: "PUT" as const,
    key: "lampiran/x/a b (1).bin",
    expires: 3600,
    params: { partNumber: "3", uploadId: "multipartId.1" },
  };
  const url1 = await presignObject(S3_CFG, { ...baseArgs, now: new Date(Date.UTC(2026, 0, 15, 0, 0, 0)) });
  const url2 = await presignObject(S3_CFG, { ...baseArgs, now: new Date(Date.UTC(2026, 0, 15, 0, 0, 0)) });
  assert.equal(url1, url2, "presign harus deterministik untuk masukan sama");

  const parsed = new URL(url1);
  assert.equal(parsed.host, "s3.example.com");
  assert.ok(decodeURIComponent(parsed.pathname).includes("/test-bucket/lampiran/x/a b (1).bin"));
  for (const q of ["X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Signature", "X-Amz-SignedHeaders"]) {
    assert.ok(parsed.searchParams.has(q), `${q} harus ada di presigned URL`);
  }
  assert.ok(parsed.searchParams.get("partNumber") === "3");
  assert.equal(parsed.searchParams.get("X-Amz-Expires"), "3600");
  assert.ok(
    (parsed.searchParams.get("X-Amz-Credential") ?? "").includes("s3/aws4_request"),
    "scope tanda tangan harus mencantumkan s3/aws4_request"
  );

  const url3 = await presignObject(S3_CFG, {
    ...baseArgs,
    key: "lampiran/x/../ü/.hidden",
    now: new Date(Date.UTC(2026, 0, 15, 0, 0, 0)),
  });
  assert.ok(url3.includes("X-Amz-Signature"), "tanda tangan tetap sah pada karakter kutip");

  /* ---- Parser SSE ---- */
  const parser = createSseParser();
  const sseChunk =
    ': KEEPALIVE 240\n' +
    'data: {"id":"1","choices":[{"delta":{"content":"Hal"},"index":0}]}\n' +
    'data: {"id":"1","choices":[{"delta":{"content":"o"}}]}\n' +
    'data: {"error":{"message":"Rate limit exceeded"}}\n' +
    'data: [DONE]\n';
  const events = [...parser.push(sseChunk)];
  assert.deepEqual(
    events.map((e) => ({ text: e.text, error: e.error })),
    [
      { text: "Hal", error: undefined },
      { text: "o", error: undefined },
      { text: undefined, error: "Rate limit exceeded" },
    ],
    "parsing SSE harus bersih dari komentar & [DONE]"
  );

  /* ---- Pemindaian ZIP ---- */
  assert.equal(isUnsafePath("../etc/passwd"), true);
  assert.equal(isUnsafePath("a/../../b"), true);
  assert.equal(isUnsafePath("absolut/path.txt"), false);

  const big = strToU8("A".repeat(3 * 1024 * 1024));
  const zipped = zipSync(
    {
      "pro/README.md": strToU8("# Halo"),
      "pro/src/index.ts": strToU8("const x = 1;"),
      "pro/bigfile.txt": big,
      "pro/evil/../evil.txt": strToU8("bad path"),
      "pro/data.bin": strToU8("\u0000\u0001\u0002"),
    },
    { level: 0 }
  );
  const blobLike = new Blob([zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength)]);
  const scan = await scanZipFile(blobLike);
  const paths = scan.textFiles.map((f) => f.path);
  assert.ok(paths.includes("pro/README.md"));
  assert.ok(paths.includes("pro/src/index.ts"));
  assert.ok(
    !paths.includes("pro/bigfile.txt"),
    "file 3 MB harus dilewati (batas teks 2 MB)"
  );
  const bigEntry = scan.entries.find((e) => e.path === "pro/bigfile.txt");
  assert.ok(bigEntry && bigEntry.skipped === "terlalu-besar-untuk-dibaca");
  assert.ok(
    !paths.some((p) => p.includes("evil")),
    "path traversal harus ditolak"
  );
  assert.ok(
    scan.entries.some((e) => e.path === "pro/data.bin" && e.skipped === "biner"),
    "file biner harus dicatat dilewati"
  );

  /* ---- Rantai failover ---- */
  process.env.MODEL_CHAIN = "m/a,m/b,m/c";
  const orderAuto = buildAttemptOrder(null);
  assert.deepEqual(
    orderAuto.map((m) => m.id).slice(0, 3),
    ["m/a", "m/b", "m/c"],
    "mode otomatis memakai urutan konfigurasi"
  );
  const orderManual = buildAttemptOrder("z/x");
  assert.equal(orderManual[0].id, "z/x", "pilihan manual berada di awal");
  assert.ok(orderManual.length <= 5, "jumlah percobaan dibatasi");

  console.log("✔ Semua pemeriksaan verifikasi lulus.");
}

main().catch((err) => {
  console.error("✘ Pemeriksaan verifikasi gagal:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
