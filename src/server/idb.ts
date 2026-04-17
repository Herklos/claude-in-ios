import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveIdb(): string {
  if (process.env.IDB_PATH) return process.env.IDB_PATH;
  // venv relative to project root (two levels up from src/server/)
  const venvIdb = path.resolve(__dirname, "../../venv/bin/idb");
  if (fs.existsSync(venvIdb)) return venvIdb;
  return "idb"; // hope it's on PATH
}

const IDB = resolveIdb();

async function idb(args: string[]): Promise<string> {
  const result = await execa(IDB, args);
  return result.stdout;
}

export async function tap(udid: string, x: number, y: number): Promise<void> {
  await idb(["ui", "tap", String(x), String(y), "--udid", udid]);
}

export async function swipe(
  udid: string,
  from: [number, number],
  to: [number, number],
  durationMs = 200,
): Promise<void> {
  await idb([
    "ui", "swipe",
    String(from[0]), String(from[1]),
    String(to[0]), String(to[1]),
    "--duration", String(durationMs / 1000),
    "--udid", udid,
  ]);
}

export async function text(udid: string, value: string): Promise<void> {
  await idb(["ui", "text", value, "--udid", udid]);
}

export async function button(udid: string, btn: string): Promise<void> {
  await idb(["ui", "button", btn, "--udid", udid]);
}

export async function keycode(udid: string, code: number): Promise<void> {
  await idb(["ui", "key", String(code), "--udid", udid]);
}

export async function describeAll(udid: string): Promise<unknown> {
  const raw = await idb(["ui", "describe-all", "--udid", udid]);
  return JSON.parse(raw);
}

export async function isAvailable(): Promise<boolean> {
  try {
    await execa(IDB, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

