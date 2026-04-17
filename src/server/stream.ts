import { bus } from "./bus.js";
import { screenshot } from "./simctl.js";

const ACTIVE_INTERVAL_MS = 100;  // ~10 fps attempt; simctl latency limits real fps to 5–8
const IDLE_INTERVAL_MS = 2000;   // drop to ~0.5 fps after 2 s of no input

let udid = "booted";
let lastInputTs = 0;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function markInput(): void {
  lastInputTs = Date.now();
}

async function capture(): Promise<void> {
  if (!running) return;
  try {
    const jpeg = await screenshot(udid);
    bus.emitTyped("frame", { type: "frame", data: jpeg });
  } catch {
    // sim may be locked or transitioning — skip frame silently
  }
  const idle = Date.now() - lastInputTs > 2000;
  timer = setTimeout(capture, idle ? IDLE_INTERVAL_MS : ACTIVE_INTERVAL_MS);
}

export function startStream(deviceUdid = "booted"): void {
  if (running) return;
  udid = deviceUdid;
  running = true;
  lastInputTs = Date.now();
  void capture();
}

export function stopStream(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
