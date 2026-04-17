import { EventEmitter } from "node:events";

export type FrameEvent = { type: "frame"; data: Buffer };
export type LogEvent = {
  type: "log";
  source: "metro" | "os";
  ts: number;
  message: string;
  raw: unknown;
};
export type HardwareButton = "HOME" | "LOCK" | "SIDE_BUTTON" | "SIRI" | "APPLE_PAY";

export type InputEvent =
  | { type: "tap"; x: number; y: number }
  | { type: "swipe"; from: [number, number]; to: [number, number]; durationMs?: number }
  | { type: "text"; value: string }
  | { type: "button"; button: HardwareButton }
  | { type: "keycode"; code: number }
  | { type: "openurl"; url: string };

export type UiEvent = { type: "ui"; tree: unknown };

export type BusEventMap = {
  frame: FrameEvent;
  log: LogEvent;
  input: InputEvent;
  ui: UiEvent;
};

class Bus extends EventEmitter {
  emitTyped<K extends keyof BusEventMap>(event: K, data: BusEventMap[K]): boolean {
    return super.emit(event, data);
  }

  onTyped<K extends keyof BusEventMap>(event: K, listener: (data: BusEventMap[K]) => void): this {
    return super.on(event, listener);
  }
}

export const bus = new Bus();
