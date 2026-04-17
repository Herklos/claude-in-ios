import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { startServer, type StartedServer } from "../server/index.js";
import { tap, swipe, text, button, describeAll } from "../server/idb.js";
import { openUrl, boot as bootSim, listDevices } from "../server/simctl.js";
import { logsSince, startMetroLogs, startOsLogs } from "../server/logs.js";
import { screenshot } from "../server/simctl.js";

let srv: StartedServer | null = null;
let serverUdid = "booted";

async function ensureServer(port: number): Promise<StartedServer> {
  if (!srv) {
    srv = await startServer({ port });
    serverUdid = srv.udid;
    startMetroLogs();
    startOsLogs(serverUdid);
  }
  return srv;
}

export async function runMcp(port: number): Promise<void> {
  const server = new McpServer({ name: "ios-simulator-preview", version: "0.1.0" });

  server.tool("get_preview_url", "Get the URL of the local simulator preview page", {}, async () => {
    const s = await ensureServer(port);
    return { content: [{ type: "text", text: JSON.stringify({ url: s.url }) }] };
  });

  server.tool("boot", "Boot an iOS simulator", {
    udid: z.string().optional().describe("Simulator UDID; omit to boot default"),
  }, async ({ udid }) => {
    const devices = await listDevices();
    const target = udid
      ? devices.find((d) => d.udid === udid)
      : devices.find((d) => d.state === "Shutdown");
    if (!target) throw new Error("No suitable simulator found");
    await bootSim(target.udid);
    srv = null; // reset so next call picks up new device
    const s = await ensureServer(port);
    return { content: [{ type: "text", text: JSON.stringify({ udid: s.udid, url: s.url }) }] };
  });

  server.tool("screenshot", "Capture a single screenshot as base64 JPEG", {}, async () => {
    const s = await ensureServer(port);
    const jpeg = await screenshot(s.udid);
    return { content: [{ type: "image", data: jpeg.toString("base64"), mimeType: "image/jpeg" }] };
  });

  server.tool("tap", "Tap at point coordinates (simulator points)", {
    x: z.number(),
    y: z.number(),
  }, async ({ x, y }) => {
    const s = await ensureServer(port);
    await tap(s.udid, x, y);
    return { content: [{ type: "text", text: "tapped" }] };
  });

  server.tool("swipe", "Swipe from one point to another", {
    from: z.tuple([z.number(), z.number()]),
    to: z.tuple([z.number(), z.number()]),
    durationMs: z.number().optional(),
  }, async ({ from, to, durationMs }) => {
    const s = await ensureServer(port);
    await swipe(s.udid, from as [number, number], to as [number, number], durationMs);
    return { content: [{ type: "text", text: "swiped" }] };
  });

  server.tool("type", "Type text into the focused field", {
    text: z.string(),
  }, async ({ text: value }) => {
    const s = await ensureServer(port);
    await text(s.udid, value);
    return { content: [{ type: "text", text: "typed" }] };
  });

  server.tool("open_url", "Open a URL or deep link in the simulator", {
    url: z.string(),
  }, async ({ url }) => {
    const s = await ensureServer(port);
    await openUrl(s.udid, url);
    return { content: [{ type: "text", text: "opened" }] };
  });

  server.tool("describe_ui", "Get the full accessibility tree of the simulator screen", {}, async () => {
    const s = await ensureServer(port);
    const tree = await describeAll(s.udid);
    return { content: [{ type: "text", text: JSON.stringify(tree) }] };
  });

  server.tool("logs_since", "Get recent logs from Metro or OS", {
    sinceMs: z.number().optional().describe("Unix ms timestamp; defaults to last 5 seconds"),
    source: z.enum(["metro", "os", "all"]).optional(),
  }, async ({ sinceMs, source }) => {
    const since = sinceMs ?? Date.now() - 5000;
    const entries = logsSince(since, source ?? "all");
    return { content: [{ type: "text", text: JSON.stringify(entries) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP clients communicate over stdin/stdout. Log to stderr so it's visible in VS Code Output.
  process.stderr.write("ios-simulator-preview MCP ready — waiting for JSON-RPC on stdin\n");
}
