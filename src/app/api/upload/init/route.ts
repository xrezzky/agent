import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { getS3Config, presignObject, safeObjectKey, signedFetch, type UploadInitResult } from "@/lib/s3";

export const dynamic = "force-dynamic";

/** Ambang mulai multipart: 64 MB. */
const MULTIPART_THRESHOLD = 64 * 1024 * 1024;
/** Ukuran bagian multipart: 64 MB (maksimal 10.000 bagian untuk file besar). */
const PART_SIZE = 64 * 1024 * 1024;
const PART_URL_TTL = 6 * 60 * 60; // 6 jam

interface InitBody {
  name?: string;
  size?: number;
  type?: string;
}

/**
 * POST /api/upload/init
 * Membuat sesi upload: URL presigned langsung ke storage (browser → storage,
 * bukan melalui body Vercel Functions) sehingga file besar hingga 250 MB+ tetap
 * bisa diunggah. Jika storage belum dikonfigurasi, kembalikan 503 + petunjuk.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Sesi berakhir. Silakan login ulang." }, { status: 401 });
  }

  const cfg = getS3Config();
  if (!cfg) {
    return NextResponse.json(
      {
        error: "Storage belum dikonfigurasi.",
        hint:
          "Isi S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, dan S3_SECRET_ACCESS_KEY " +
          "di .env.local (lihat README bagian Storage). Sementara itu, file teks kecil " +
          "tetap bisa dilampirkan secara inline.",
        configured: false,
      },
      { status: 503 }
    );
  }

  let body: InitBody;
  try {
    body = (await req.json()) as InitBody;
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const name = typeof body.name === "string" && body.name ? body.name : "file-tanpa-nama";
  const size = Number(body.size);
  const type = typeof body.type === "string" ? body.type : "";
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "Ukuran file tidak valid." }, { status: 400 });
  }

  const maxMb = Number(process.env.MAX_UPLOAD_MB) || 250;
  if (size > maxMb * 1024 * 1024) {
    return NextResponse.json(
      { error: `Ukuran file melebihi batas layanan (${maxMb} MB).` },
      { status: 413 }
    );
  }

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  const key = safeObjectKey(stem, ext);

  try {
    if (size < MULTIPART_THRESHOLD) {
      const url = await presignObject(cfg, { method: "PUT", key, expires: PART_URL_TTL });
      const result: UploadInitResult = { uploadId: null, key, partUrls: [], singleUrl: url };
      return NextResponse.json({ ...result, multipart: false, partSize: null });
    }

    // Inisialisasi multipart upload bertanda tangan header.
    const res = await signedFetch(cfg, "POST", key, "", { uploads: "" });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`[upload/init] gagal init multipart: ${res.status} ${detail}`);
      return NextResponse.json(
        { error: `Storage menolak sesi multipart (${res.status}). Cek kredensial S3.` },
        { status: 502 }
      );
    }
    const xml = await res.text();
    const uploadId = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
    if (!uploadId) {
      return NextResponse.json(
        { error: "Respons storage tidak berisi UploadId." },
        { status: 502 }
      );
    }

    const partCount = Math.ceil(size / PART_SIZE);
    const partUrls: { part: number; url: string }[] = [];
    for (let part = 1; part <= partCount; part++) {
      partUrls.push({
        part,
        url: await presignObject(cfg, {
          method: "PUT",
          key,
          expires: PART_URL_TTL,
          params: { partNumber: String(part), uploadId } as Record<string, string>,
        }),
      });
    }

    const result: UploadInitResult = { uploadId, key, partUrls, singleUrl: null };
    return NextResponse.json({ ...result, multipart: true, partSize: PART_SIZE });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal menyiapkan upload.";
    console.error(`[upload/init] ${message}`);
    return NextResponse.json({ error: "Storage tidak dapat dihubungi." }, { status: 502 });
  }
}
