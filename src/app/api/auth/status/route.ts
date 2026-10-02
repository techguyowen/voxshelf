import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, isLocked, keyMatches } from "@/lib/auth";
import { toApiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/status — { locked, authed } for the unlock gate. */
export async function GET(req: NextRequest) {
  try {
    if (!isLocked()) return NextResponse.json({ locked: false, authed: true });
    const authed = keyMatches(req.cookies.get(AUTH_COOKIE)?.value ?? null);
    return NextResponse.json({ locked: true, authed });
  } catch (err) {
    return toApiError(err);
  }
}
