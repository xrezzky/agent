import { NextResponse, type NextRequest } from "next/server";
import { checkOwnerCredentials } from "@/lib/auth";
import { buildSetCookie, createSessionToken, getAuthSecret } from "@/lib/session";

/**
 * POST /api/auth/login  { username, password }
 * Tidak ada pendaftaran publik — hanya pemilik yang bisa masuk,
 * kredensialnya dibaca dari environment variable server.
 */
export async function POST(req: NextRequest) {
  const secret = getAuthSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "AUTH_SECRET belum dikonfigurasi di server. Isi .env.local terlebih dahulu." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }
  const { username, password } = (body ?? {}) as { username?: string; password?: string };
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return NextResponse.json({ error: "Nama pengguna dan password wajib diisi." }, { status: 400 });
  }

  // Rate limit sederhana per IP untuk mengurangi brute force.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "lokal";
  const key = `login:${ip}`;
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && rec.count >= 10 && now - rec.first < 10 * 60 * 1000) {
    return NextResponse.json(
      { error: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit." },
      { status: 429 }
    );
  }

  if (!checkOwnerCredentials(username, password)) {
    const entry = rec && now - rec.first < 10 * 60 * 1000 ? rec : { first: now, count: 0 };
    entry.count += 1;
    attempts.set(key, entry);
    return NextResponse.json({ error: "Nama pengguna atau password salah." }, { status: 401 });
  }

  attempts.delete(key);
  const token = await createSessionToken(username, secret);
  return new NextResponse(null, {
    status: 204,
    headers: { "Set-Cookie": buildSetCookie(token) },
  });
}

const attempts = new Map<string, { first: number; count: number }>();
