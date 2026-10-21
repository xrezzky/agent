import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { getS3Config, signedFetch } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * POST /api/upload/abort
 * Membatalkan sesi multipart upload dan menghapus bagian yang sudah
 * tergundgah di storage (menghindari sampah bucket yang ditagih).
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

  let body: { objectKey?: string; uploadId?: string };
  try {
    body = (await req.json()) as { objectKey?: string; uploadId?: string };
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const key = body.objectKey ?? "";
  if (!key.startsWith("lampiran/") || key.includes("..") || !body.uploadId) {
    return NextResponse.json({ error: "Parameter tidak valid." }, { status: 400 });
  }

  const res = await signedFetch(cfg, "DELETE", key, "", { uploadId: body.uploadId });
  if (!res.ok && res.status !== 404) {
    console.error(`[upload/abort] storage menolak (${res.status})`);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
