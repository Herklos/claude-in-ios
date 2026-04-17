import { execa } from "execa";

export interface Device {
  udid: string;
  name: string;
  state: string;
  deviceTypeIdentifier: string;
}

export interface DeviceList {
  devices: Record<string, Device[]>;
}

export async function listDevices(): Promise<Device[]> {
  const result = await execa("xcrun", ["simctl", "list", "devices", "--json"]);
  const parsed = JSON.parse(result.stdout) as DeviceList;
  return Object.values(parsed.devices).flat();
}

export async function bootedDevice(): Promise<Device | undefined> {
  const devices = await listDevices();
  return devices.find((d) => d.state === "Booted");
}

export async function boot(udid: string): Promise<void> {
  await execa("xcrun", ["simctl", "boot", udid]);
}

export async function openUrl(udid: string, url: string): Promise<void> {
  await execa("xcrun", ["simctl", "openurl", udid, url]);
}

export async function screenshot(udid: string): Promise<Buffer> {
  const result = await execa("xcrun", [
    "simctl", "io", udid, "screenshot", "--type=jpeg", "-",
  ], { encoding: "buffer" });
  return Buffer.from(result.stdout as unknown as Uint8Array);
}

export interface DeviceInfo {
  udid: string;
  name: string;
  pointWidth: number;
  pointHeight: number;
}

const DEVICE_POINTS: Record<string, { w: number; h: number }> = {
  "iPhone-15": { w: 393, h: 852 },
  "iPhone-15-Pro": { w: 393, h: 852 },
  "iPhone-15-Pro-Max": { w: 430, h: 932 },
  "iPhone-15-Plus": { w: 430, h: 932 },
  "iPhone-SE-3rd-generation": { w: 375, h: 667 },
};

export function getDevicePoints(deviceTypeIdentifier: string): { w: number; h: number } {
  for (const [key, val] of Object.entries(DEVICE_POINTS)) {
    if (deviceTypeIdentifier.includes(key)) return val;
  }
  return { w: 390, h: 844 };
}
