import { NextRequest, NextResponse } from "next/server";
import {
  getDocumentDetail,
  getPrerenderStats,
  updateSentenceAudio,
} from "@/lib/documents";
import { apiError } from "@/lib/http";
import { synthesizeAndCache } from "@/lib/tts";
import { isValidVoice } from "@/lib/voices";
import type { PrerenderOptions } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_CONCURRENCY = 3;
const MAX_ATTEMPTS = 4;

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit|quota|too many|overloaded|503|resource.?exhausted/i.test(
    msg,
  );
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 400);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET /api/documents/[id]/prerender — offline-readiness stats for a document.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const stats = getPrerenderStats(id);
  if (!stats) return apiError("Document not found.", 404);
  return NextResponse.json(stats);
}

/**
 * POST /api/documents/[id]/prerender — synthesize a sentence range in advance.
 * Streams Server-Sent Events: `start`, per-sentence `progress`/`error`, then
 * a final `complete` summary. Each finished sentence updates the `sentences`
 * table with its `audio_hash` and `audio_duration_ms`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const doc = getDocumentDetail(id);
  if (!doc) return apiError("Document not found.", 404);
  if (doc.sentences.length === 0) {
    return apiError("Document has no sentences.", 400);
  }

  let body: PrerenderOptions = {};
  try {
    body = (await req.json()) as PrerenderOptions;
  } catch {
    body = {};
  }

  const total = doc.sentences.length;
  const startIndex = Math.max(
    0,
    Math.min(total - 1, Math.floor(body.startIndex ?? 0)),
  );
  const count = Math.max(
    1,
    Math.min(total - startIndex, Math.floor(body.count ?? total - startIndex)),
  );
  const concurrency = Math.max(
    1,
    Math.min(8, Math.floor(body.concurrency ?? DEFAULT_CONCURRENCY)),
  );
  const voice =
    body.voice && isValidVoice(body.voice) ? body.voice : doc.voice;
  const style = (body.stylePrompt ?? doc.stylePrompt ?? "").trim();
  const targets = doc.sentences.slice(startIndex, startIndex + count);

  const encoder = new TextEncoder();
  const signal = req.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };
      const aborted = () => signal.aborted;

      send({ type: "start", total: targets.length, startIndex, voice });

      let cursor = 0;
      let completed = 0;
      let synthesized = 0;
      let cached = 0;
      let failed = 0;
      let totalDurationMs = 0;

      const worker = async () => {
        for (;;) {
          if (aborted()) return;
          const i = cursor;
          cursor += 1;
          if (i >= targets.length) return;
          const s = targets[i];
          const preview = s.text.slice(0, 120);

          let attempt = 0;
          for (;;) {
            if (aborted()) return;
            try {
              const result = await synthesizeAndCache(s.text, voice, style);
              updateSentenceAudio(id, s.idx, result.hash, result.durationMs);
              completed += 1;
              totalDurationMs += result.durationMs;
              if (result.cached) cached += 1;
              else synthesized += 1;
              send({
                type: "progress",
                sentenceIdx: s.idx,
                completed,
                total: targets.length,
                cached: result.cached,
                durationMs: result.durationMs,
                textPreview: preview,
              });
              break;
            } catch (err) {
              attempt += 1;
              if (isRateLimitError(err) && attempt < MAX_ATTEMPTS && !aborted()) {
                await sleep(backoffMs(attempt));
                continue;
              }
              completed += 1;
              failed += 1;
              send({
                type: "error",
                sentenceIdx: s.idx,
                completed,
                total: targets.length,
                message: err instanceof Error ? err.message : "Synthesis failed.",
                textPreview: preview,
              });
              break;
            }
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, targets.length) }, () =>
          worker(),
        ),
      );
      if (!aborted()) {
        send({
          type: "complete",
          total: targets.length,
          synthesized,
          cached,
          failed,
          totalDurationMs,
        });
      }
      controller.close();
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
