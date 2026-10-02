import { NextRequest, NextResponse } from "next/server";
import { authCookieHeader, isLocked, keyMatches } from "@/lib/auth";
import { apiError, toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/login — { key } → sets the httpOnly auth cookie. */
export async function POST(req: NextRequest) {
  try {
    if (!isLocked()) return NextResponse.json({ ok: true, locked: false });
    const body = (await req.json().catch(() => null)) as { key?: unknown } | null;
    const key = typeof body?.key === "string" ? body.key : "";
    if (!keyMatches(key)) {
      await new Promise((r) => setTimeout(r, 500));
      return apiError("Incorrect key.", 401);
    }
    const res = NextResponse.json({ ok: true, locked: true });
    res.headers.set("Set-Cookie", authCookieHeader());
    return res;
  } catch (err) {
    return toApiError(err);
  }
}
