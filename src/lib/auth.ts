// Optional shared-key lock for exposed servers (see docs/SERVER.md).
//
// When API_KEY is unset the server is open (LAN default). When set, every
// /api route except /api/health and /api/auth/* must call requireAuth() —
// grep for it when adding routes. Browser clients authenticate with an
// httpOnly cookie; sync peers use `Authorization: Bearer <key>`.

import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const AUTH_COOKIE = "vs-auth";
const COOKIE_MAX_AGE = 30 * 24 * 3600; // 30 days

export function isLocked(): boolean {
  return (process.env.API_KEY || "").trim().length > 0;
}

export function keyMatches(candidate: string | null | undefined): boolean {
  const expected = (process.env.API_KEY || "").trim();
  if (!expected || !candidate) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function bearerKey(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const m = /^Bearer (.+)$/.exec(header.trim());
  return m?.[1]?.trim() || null;
}

/**
 * Returns a 401 JSON response when the request is not authorized, or null
 * when it may proceed. Open servers (no API_KEY) always proceed.
 */
export function requireAuth(req: NextRequest): NextResponse | null {
  if (!isLocked()) return null;
  const candidate = bearerKey(req) ?? req.cookies.get(AUTH_COOKIE)?.value ?? null;
  if (keyMatches(candidate)) return null;
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

export function authCookieHeader(): string {
  const key = (process.env.API_KEY || "").trim();
  return `${AUTH_COOKIE}=${encodeURIComponent(key)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax`;
}

export function clearAuthCookieHeader(): string {
  return `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
