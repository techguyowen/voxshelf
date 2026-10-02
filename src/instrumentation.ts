/** Runs once at server startup (standalone + dev). Starts sync + housekeeping. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSyncScheduler } = await import("./lib/syncWorker");
    ensureSyncScheduler();
  }
}
