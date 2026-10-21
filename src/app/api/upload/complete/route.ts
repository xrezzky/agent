import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { getS3Config, signedFetch } from "@/lib/s3";

export const dynamic = "force-dynamic";

interface CompleteBody {
  objectKey?: string;
  uploadId?: string;
  parts?: { part: number; etag: string }[];
}

/**
 * POST /api/upload/complete
 * Menyelesaikan multipart upload (menggabungkan bagian di storage).
 * Hanya menerima kunci di bawah prefix internal "lampiran/".
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

  let body: CompleteBody;
  try {
    body = (await req.json()) as CompleteBody;
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const key = body.objectKey ?? "";
  if (!key.startsWith("lampiran/") || key.includes("..")) {
    return NextResponse.json({ error: "Kunci objek tidak valid." }, { status: 400 });
  }

  const parts = (body.parts ?? [])
    .filter((p) => Number.isInteger(p.part) && p.part >= 1 && typeof p.etag === "string")
    .sort((a, b) => a.part - b.part);
  if (parts.length === 0) {
    return NextResponse.json({ error: "Daftar bagian kosong." }, { status: 400 });
  }

  const xml =
    `<CompleteMultipartUpload>` +
    parts
      .map(
        (p) =>
          `<Part><PartNumber>${p.part}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`
      )
      .join("") +
    `</CompleteMultipartUpload>`;

  const res = await signedFetch(cfg, "POST", key, xml, { uploadId: body.uploadId ?? "" });
  const text = await res.text().catch(() => "");
  if (!res.ok || /<Error>/.test(text)) {
    const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? String(res.status);
    console.error(`[upload/complete] gagal: ${code}`);
    return NextResponse.json(
      { error: `Storage menolak penyelesaian upload (${code}).` },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;"
  );
}
