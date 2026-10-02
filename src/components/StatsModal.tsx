"use client";

import { BookOpen, Clock3, Flame, Loader2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { ReadingStats } from "@/lib/types";
import { Modal } from "./Modal";

function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-center dark:border-zinc-800 dark:bg-zinc-800/50">
      <div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm dark:bg-zinc-900">
        {icon}
      </div>
      <p className="text-lg font-bold tabular-nums leading-tight">{value}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
    </div>
  );
}

function weekdayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? isoDate.slice(5)
    : d.toLocaleDateString(undefined, { weekday: "narrow" });
}

export function StatsModal({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getStats()
      .then((s) => {
        if (live) setStats(s);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Failed to load stats.");
      });
    return () => {
      live = false;
    };
  }, []);

  const maxMinutes = Math.max(1, ...(stats?.last7.map((d) => d.minutes) ?? [1]));

  return (
    <Modal title="Reading Stats" onClose={onClose}>
      {error ? (
        <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !stats ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
          <Loader2 size={17} className="animate-spin" /> Crunching your numbers…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              icon={<Flame size={17} className="text-orange-500" />}
              value={stats.currentStreak > 0 ? `🔥 ${stats.currentStreak}` : "0"}
              label={stats.currentStreak === 1 ? "day streak" : "day streak"}
            />
            <StatCard
              icon={<Clock3 size={17} className="text-emerald-600 dark:text-emerald-400" />}
              value={stats.totalMinutes >= 60
                ? `${Math.floor(stats.totalMinutes / 60)}h ${Math.round(stats.totalMinutes % 60)}m`
                : `${stats.totalMinutes}m`}
              label="listened"
            />
            <StatCard
              icon={<BookOpen size={17} className="text-sky-600 dark:text-sky-400" />}
              value={stats.totalWords >= 1000
                ? `${(stats.totalWords / 1000).toFixed(1)}k`
                : `${stats.totalWords}`}
              label="words ingested"
            />
            <StatCard
              icon={<Zap size={17} className="text-amber-500" />}
              value={`${stats.hoursSaved}h`}
              label="saved by speed"
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Last 7 days
            </p>
            <div className="flex h-36 items-end gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
              {stats.last7.map((d) => {
                const pct = Math.max(2, Math.round((d.minutes / maxMinutes) * 100));
                const isToday = d.date === new Date().toISOString().slice(0, 10);
                return (
                  <div
                    key={d.date}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1 self-stretch"
                    title={`${d.date}: ${d.minutes} min`}
                  >
                    <span className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                      {d.minutes > 0 ? d.minutes : ""}
                    </span>
                    <div
                      className={`w-full max-w-10 rounded-t-md ${
                        d.minutes > 0
                          ? isToday
                            ? "bg-emerald-600 dark:bg-emerald-500"
                            : "bg-emerald-400 dark:bg-emerald-700"
                          : "bg-zinc-200 dark:bg-zinc-700"
                      }`}
                      style={{ height: `${pct}%` }}
                    />
                    <span
                      className={`text-[10px] font-medium ${
                        isToday
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-zinc-500 dark:text-zinc-400"
                      }`}
                    >
                      {weekdayLabel(d.date)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {stats.totalSeconds === 0 && (
            <p className="rounded-lg bg-zinc-100 px-3 py-2 text-center text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              Press play on any document — your listening time, streaks, and
              speed savings will show up here.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
