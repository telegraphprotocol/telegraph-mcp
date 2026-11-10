import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// What this wallet's asks have cost today (UTC), in a file, so a restart does
// not reset the daily limit. A cost is recorded before the payment is signed
// and given back if nothing was charged, so asks running at the same time
// cannot all pass the check. The count is per server process: two apps sharing
// one wallet each keep their own, so the daily limit holds per app.
export class SpendLog {
  private file: string;

  constructor(home: string) {
    this.file = join(home, "spend.json");
  }

  private read(): Record<string, number> {
    try {
      return existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : {};
    } catch {
      return {};
    }
  }

  today(): number {
    return this.read()[day()] ?? 0;
  }

  // Negative gives a reservation back. Written to a temporary file and renamed,
  // which is atomic, so a crash or a second process leaves a whole file.
  add(usd: number) {
    // Keep a week, so the file stays small.
    const all = Object.fromEntries(Object.entries(this.read()).filter(([k]) => k >= day(-7)));
    all[day()] = Math.max(0, Math.round(((all[day()] ?? 0) + usd) * 1e6) / 1e6);
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = join(dirname(this.file), `spend.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(all) + "\n", { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

// Answers an identical ask from the one in flight, or from the last successful
// one, so an agent that retries is not charged twice.
export class Dedupe<T> {
  private inflight = new Map<string, Promise<T>>();
  private recent = new Map<string, { at: number; value: T }>();

  constructor(private windowMs: number) {}

  // How many answers are held: 0 once the window has passed.
  get size() {
    return this.recent.size;
  }

  async run(key: string, paid: (value: T) => boolean, fn: () => Promise<T>): Promise<{ value: T; repeated: boolean }> {
    const hit = this.recent.get(key);
    if (hit && Date.now() - hit.at < this.windowMs) return { value: hit.value, repeated: true };
    const running = this.inflight.get(key);
    if (running) return { value: await running, repeated: true };
    const p = fn();
    this.inflight.set(key, p);
    try {
      const value = await p;
      if (paid(value)) {
        // Drop answers past the window, so a long-running server does not hold
        // every answer it has ever given.
        for (const [k, v] of this.recent) if (Date.now() - v.at >= this.windowMs) this.recent.delete(k);
        this.recent.set(key, { at: Date.now(), value });
      }
      return { value, repeated: false };
    } finally {
      this.inflight.delete(key);
    }
  }
}

// The same ask gives the same key, whatever order the model sent the fields in.
export const requestKey = (path: string, body: unknown) =>
  createHash("sha256")
    .update(path)
    .update(
      JSON.stringify(body, (_k, v) =>
        v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v,
      ) ?? "",
    )
    .digest("hex");
