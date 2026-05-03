/**
 * Tiny leveled stderr logger. Respects LOG_LEVEL (debug | info | warn | error).
 * Avoids any runtime dep.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function currentThreshold(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw in LEVELS) return LEVELS[raw as Level];
  return LEVELS.info;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < currentThreshold()) return;
  const stamp = new Date().toISOString();
  const suffix = fields ? ` ${JSON.stringify(fields)}` : "";
  process.stderr.write(`[${stamp}] [${level}] ${msg}${suffix}\n`);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
