import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { getModelChain, getFallbackModel } from "@/lib/models";

export const dynamic = "force-dynamic";

/**
 * GET /api/models
 * Menggabungkan:
 * 1) Rantai model prioritas dari konfigurasi server (MODEL_CHAIN/FALLBACK_MODEL),
 * 2) (opsional) daftar model asli dari OpenRouter bila API key tersedia.
 * ID diambil langsung dari API OpenRouter — tidak mengarang.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Sesi berakhir. Silakan login ulang." }, { status: 401 });
  }

  const chain = getModelChain();
  const fallback = getFallbackModel();
  const configured: { id: string; label: string }[] = [
    ...chain,
    ...(fallback.id && !chain.some((m) => m.id === fallback.id) ? [fallback] : []),
  ];

  let catalog: { id: string; label: string; vision: boolean | null }[] = [];
  let catalogError: string | null = null;
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as { data?: unknown[] };
        catalog = (data.data ?? [])
          .map((m) => {
            const model = m as {
              id?: string;
              name?: string;
              architecture?: { input_modalities?: string[] | string };
            };
            if (!model.id) return null;
            const mod = model.architecture?.input_modalities;
            const vision =
              mod === undefined || mod === null
                ? null
                : (Array.isArray(mod) ? mod : String(mod).split(","))
                    .map((s) => s.trim())
                    .includes("image");
            return {
              id: model.id,
              label: model.name ?? model.id,
              vision,
            };
          })
          .filter((m): m is NonNullable<typeof m> => m !== null);
      } else {
        catalogError = `Katalog model tidak tersedia (${res.status}).`;
      }
    } catch {
      catalogError = "Katalog model tidak dapat diambil (jaringan/timeout).";
    }
  }

  return NextResponse.json({ configured, catalog, catalogError });
}
