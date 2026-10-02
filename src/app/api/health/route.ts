import { readFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { dbEngine, getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** GET /api/health — liveness probe for Docker / load balancers. */
export async function GET() {
  try {
    getDb().prepare("SELECT 1").get();
    return NextResponse.json({
      ok: true,
      version: appVersion(),
      engine: dbEngine(),
      time: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "DB unavailable" },
      { status: 503 },
    );
  }
}
