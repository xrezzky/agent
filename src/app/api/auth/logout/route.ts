import { NextResponse } from "next/server";
import { CLEAR_COOKIE } from "@/lib/session";

/** POST /api/auth/logout — menghapus cookie sesi. */
export async function POST() {
  return new NextResponse(null, {
    status: 204,
    headers: { "Set-Cookie": CLEAR_COOKIE },
  });
}
