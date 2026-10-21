import { NextResponse } from "next/server";

/**
 * GET /api/status — informasi konfigurasi server yang aman ditampilkan
 * ke frontend (hanya boolean, tidak ada rahasia).
 */
export async function GET() {
  return NextResponse.json({
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    storage: isStorageConfigured(),
    maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 250,
    ownerConfigured:
      Boolean(process.env.OWNER_USERNAME) &&
      (process.env.OWNER_PASSWORD_HASH ?? "").length === 64,
  });
}

function isStorageConfigured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_REGION &&
      process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY
  );
}
