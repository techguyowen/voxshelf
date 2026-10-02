import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { dbAll } from "@/lib/db";
import { toApiError } from "@/lib/http";
import type { DailyStat } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SessionRow {
  duration_seconds: number;
  words_read: number;
  speed: number;
  created_at: string;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** GET /api/stats — aggregate listening stats, streak, and 7-day chart. */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const rows = dbAll<SessionRow>(
      "SELECT duration_seconds, words_read, speed, created_at FROM reading_sessions ORDER BY created_at ASC",
    );

    let totalSeconds = 0;
    let totalWords = 0;
    let savedSeconds = 0;
    const perDay = new Map<string, number>();
    for (const r of rows) {
      const dur = Math.max(0, Number(r.duration_seconds) || 0);
      const words = Math.max(0, Number(r.words_read) || 0);
      const speed = Number(r.speed) || 1;
      totalSeconds += dur;
      totalWords += words;
      if (speed > 1) savedSeconds += dur * (speed - 1);
      const day = dayKey(new Date(r.created_at));
      perDay.set(day, (perDay.get(day) ?? 0) + dur);
    }

    // Current streak: consecutive days with activity, ending today or yesterday.
    const today = new Date();
    const todayKey = dayKey(today);
    const yesterdayKey = dayKey(new Date(today.getTime() - 86_400_000));
    let currentStreak = 0;
    if (perDay.has(todayKey) || perDay.has(yesterdayKey)) {
      const cursor = new Date(
        perDay.has(todayKey) ? today.getTime() : today.getTime() - 86_400_000,
      );
      while (perDay.has(dayKey(cursor))) {
        currentStreak += 1;
        cursor.setTime(cursor.getTime() - 86_400_000);
      }
    }

    // Last 7 days, oldest first.
    const last7: DailyStat[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(today.getTime() - i * 86_400_000);
      const key = dayKey(d);
      last7.push({
        date: key,
        minutes: Math.round(((perDay.get(key) ?? 0) / 60) * 10) / 10,
      });
    }

    return NextResponse.json({
      totalSeconds,
      totalMinutes: Math.round((totalSeconds / 60) * 10) / 10,
      totalWords,
      currentStreak,
      last7,
      hoursSaved: Math.round((savedSeconds / 3600) * 100) / 100,
    });
  } catch (err) {
    return toApiError(err);
  }
}
