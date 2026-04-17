import { execa } from "execa";
import { bus, type LogEvent } from "./bus.js";

const LOG_RING_SIZE = 1000;
export const logRing: LogEvent[] = [];

function push(entry: LogEvent): void {
  logRing.push(entry);
  if (logRing.length > LOG_RING_SIZE) logRing.shift();
  bus.emitTyped("log", entry);
}

export function startMetroLogs(metroPort = 8081): void {
  const url = `http://127.0.0.1:${metroPort}/logs`;
  let active = true;

  async function connect(): Promise<void> {
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (active) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const raw = JSON.parse(trimmed) as unknown;
            push({ type: "log", source: "metro", ts: Date.now(), message: String((raw as Record<string, unknown>).msg ?? trimmed), raw });
          } catch {
            push({ type: "log", source: "metro", ts: Date.now(), message: trimmed, raw: trimmed });
          }
        }
      }
    } catch {
      // metro not running yet — retry
    }
    if (active) setTimeout(() => void connect(), 3000);
  }

  void connect();
}

export function startOsLogs(udid: string): void {
  const proc = execa("xcrun", [
    "simctl", "spawn", udid,
    "log", "stream", "--style=ndjson",
    "--predicate", 'subsystem CONTAINS "com.apple" OR processImagePath CONTAINS "Expo"',
  ]);

  proc.catch((err: Error) => {
    process.stderr.write(`[os-logs] simctl log stream exited: ${err.message}\n`);
  });

  proc.stdout?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const raw = JSON.parse(trimmed) as Record<string, unknown>;
        push({ type: "log", source: "os", ts: Date.now(), message: String(raw.eventMessage ?? trimmed), raw });
      } catch {
        push({ type: "log", source: "os", ts: Date.now(), message: trimmed, raw: trimmed });
      }
    }
  });
}

export function logsSince(
  sinceMs: number,
  source: "metro" | "os" | "all" = "all",
  pattern?: string,
): LogEvent[] {
  let re: RegExp | null = null;
  if (pattern) {
    try { re = new RegExp(pattern, "i"); } catch { /* bad regex — skip filter */ }
  }
  return logRing.filter(
    (e) =>
      e.ts >= sinceMs &&
      (source === "all" || e.source === source) &&
      (!re || re.test(e.message)),
  );
}
