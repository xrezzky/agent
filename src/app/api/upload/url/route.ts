import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { presignObject, getS3Config } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * POST /api/upload/url
 * Mengembalikan URL presigned yang dibatasi waktu untuk MENGUNDUH/MEMBACA
 * objek milik pemilik sendiri. File tetap privat (URL hanya berlaku singkat).
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Sesi berakhir. Silakan login ulang." }, { status: 401 });
  }

  const cfg = getS3Config();
  if (!cfg) {
    return NextResponse.json({ error: "Storage belum dikonfigurasi." }, { status: 503 });
  }

  let body: { objectKey?: string };
  try {
    body = (await req.json()) as { objectKey?: string };
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const key = body.objectKey ?? "";
  if (!key.startsWith("lampiran/") || key.includes("..")) {
    return NextResponse.json({ error: "Kunci objek tidak valid." }, { status: 400 });
  }

  try {
    const url = await presignObject(cfg, { method: "GET", key, expires: 15 * 60 });
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Gagal membuat URL baca." }, { status: 502 });
  }
}
