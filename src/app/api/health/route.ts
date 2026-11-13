import { spawnSync } from "child_process";
import { NextResponse } from "next/server";
import { dbEngine, getDb } from "@/lib/db";
import { discoverLocalAiServers } from "@/lib/localAi";
import { detectLocalTtsCapabilities } from "@/lib/localTts";
import { APP_VERSION } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let ffmpegCache: { at: number; value: boolean } | null = null;
function ffmpegAvailable(): boolean {
  if (ffmpegCache && Date.now() - ffmpegCache.at < 30000) return ffmpegCache.value;
  let value = false;
  try {
    const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 800 });
    value = !r.error && r.status === 0;
  } catch { value = false; }
  ffmpegCache = { at: Date.now(), value };
  return value;
}

export async function GET() {
  try {
    getDb().prepare("SELECT 1").get();
    const [ttsCaps, ai] = await Promise.all([
      detectLocalTtsCapabilities().catch(() => null),
      discoverLocalAiServers().catch(() => null),
    ]);
    return NextResponse.json({
      ok: true,
      status: "ok",
      version: APP_VERSION,
      engine: dbEngine(),
      time: new Date().toISOString(),
      capabilities: {
        localTts: Boolean(ttsCaps?.available),
        localTtsEngine: ttsCaps?.engine ?? null,
        ollamaOnline: Boolean(ai?.ollamaOnline),
        localLlmOnline: Boolean(ai?.localLlmOnline),
        builtinNlp: true,
        ffmpeg: ffmpegAvailable(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, status: "error", version: APP_VERSION, error: err instanceof Error ? err.message : "DB unavailable" },
      { status: 503 },
    );
  }
}
