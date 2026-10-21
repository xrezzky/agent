import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/session";

/**
 * Middleware memindahkan pengunjung yang belum memiliki sesi sah
 * ke halaman login. Pemeriksaan sesi juga dilakukan ulang di setiap
 * API route yang sensitif (gaya pertahanan berlapis).
 */
export const config = {
  matcher: ["/", "/coding", "/settings"],
};

export async function middleware(req: NextRequest) {
  const session = await verifySession(req);
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
