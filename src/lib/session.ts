/**
 * Sesi pemilik (cookie di-review HMAC).
 *
 * Format cookie: base64url(JSON payload) + "." + base64url(hmac-sha256)
 * Payload memuat `sub` (nama pemilik) dan `exp` (timestamp kedaluwarsa).
 *
 * Dipakai baik di Node (API route) maupun di Edge (middleware) karena
 * hanya memakai Web Crypto standar.
 */
import { SESSION_COOKIE, SESSION_TTL_MS } from "./constants";

export interface SessionPayload {
  sub: string;
  exp: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): Uint8Array<ArrayBuffer> {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function strToBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

async function hmac(secret: string, data: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    strToBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, data as BufferSource);
  return b64urlEncode(new Uint8Array(sig));
}

/** Memastikan secret auth sudah dikonfigurasi. */
export function getAuthSecret(): string | null {
  const raw = process.env.AUTH_SECRET ?? "";
  return raw.length >= 32 ? raw : null;
}

/** Membuat token sesi bertanda tangan. */
export async function createSessionToken(sub: string, secret: string): Promise<string> {
  const payload: SessionPayload = {
    sub,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = b64urlEncode(strToBytes(JSON.stringify(payload)));
  const sig = await hmac(secret, strToBytes(body));
  return `${body}.${sig}`;
}

/** Memverifikasi token dan mengembalikan payload bila sah. */
export async function parseSessionToken(
  token: string,
  secret: string
): Promise<SessionPayload | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, strToBytes(body));
  // Perbandingan konstanta-waktu:
  const a = strToBytes(sig);
  const b = strToBytes(expected);
  if (a.length !== b.length) return null;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------- Helper membaca cookie dari Request / NextRequest ---------- */

function readCookie(req: { headers: { get(name: string): string | null } }, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

/** Verifikasi sesi dari sebuah request (Edge & Node aman). */
export async function verifySession(
  req: { headers: { get(name: string): string | null } }
): Promise<SessionPayload | null> {
  const secret = getAuthSecret();
  if (!secret) return null;
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  return parseSessionToken(token, secret);
}

/* ---------- Hanya untuk runtime Node (route handler API) ---------- */
import type { NextRequest } from "next/server";

/** Header cookie untuk respons logout. */
export const CLEAR_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** Header Set-Cookie saat login berhasil. */
export function buildSetCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (process.env.VERCEL || process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export async function requireSession(req: NextRequest): Promise<SessionPayload | null> {
  return verifySession(req);
}
