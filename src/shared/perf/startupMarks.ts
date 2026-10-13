/**
 * Phase 68 - start-up timing marks. The main process marks "app ready", "database open", "window shown" and "page loaded"
 * (milliseconds since the process started) and writes ONE log line, so the owner can read real start-up time from the
 * log of an installed build. Pure: the clock is injected (`process.uptime() * 1000` in Electron). Never throws.
 */
export interface StartupMarks {
  mark(name: string): void
  /** Marks so far as `{ name: ms }`, in the order they were made; a name marked twice keeps its first time. */
  report(): Record<string, number>
}

export function createStartupMarks(nowMs: () => number): StartupMarks {
  const marks = new Map<string, number>()
  return {
    mark(name) {
      try {
        if (!marks.has(name)) marks.set(name, Math.round(nowMs()))
      } catch {
        /* a broken clock must never break start-up */
      }
    },
    report: () => Object.fromEntries(marks)
  }
}
