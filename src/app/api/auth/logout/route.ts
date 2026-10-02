import { NextResponse } from "next/server";
import { clearAuthCookieHeader } from "@/lib/auth";
import { toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout — clears the auth cookie. */
export async function POST() {
  try {
    const res = NextResponse.json({ ok: true });
    res.headers.set("Set-Cookie", clearAuthCookieHeader());
    return res;
  } catch (err) {
    return toApiError(err);
  }
}
