/**
 * Util autentikasi (runtime Node).
 * Password pemilik disimpan sebagai SHA-256 hex di environment variable,
 * bukan hardcoded di source code.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Memeriksa kredensial pemilik dari env. */
export function checkOwnerCredentials(username: string, password: string): boolean {
  const envUser = process.env.OWNER_USERNAME ?? "";
  const envHash = process.env.OWNER_PASSWORD_HASH ?? "";
  if (!envUser || envHash.length !== 64) return false;
  const userOk = safeEqualHex(sha256Hex(username), sha256Hex(envUser));
  const passOk = safeEqualHex(sha256Hex(password), envHash);
  return userOk && passOk;
}
