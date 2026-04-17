import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { bus, type InputEvent } from "./bus.js";
import { startStream, markInput } from "./stream.js";
import { tap, swipe, text, button, keycode } from "./idb.js";
import { openUrl, bootedDevice, getDevicePoints } from "./simctl.js";
import { screenshot } from "./simctl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "../../dist/web");
const DEV_WEB_DIR = path.resolve(__dirname, "../../src/web");

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url === "/" ? "/index.html" : (req.url ?? "/index.html");
  const base = fs.existsSync(WEB_DIR) ? WEB_DIR : DEV_WEB_DIR;
  const filePath = path.resolve(base, "." + url);

  if (!filePath.startsWith(base)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(data);
  });
}

export interface ServerConfig {
  port: number;
  udid?: string;
}

export interface StartedServer {
  url: string;
  udid: string;
  pointWidth: number;
  pointHeight: number;
  close(): void;
}

export async function startServer(config: ServerConfig): Promise<StartedServer> {
  const device = await bootedDevice();
  const udid = config.udid ?? device?.udid ?? "booted";
  const pts = device ? getDevicePoints(device.deviceTypeIdentifier) : { w: 390, h: 844 };

  const server = http.createServer((req, res) => {
    if (req.url === "/api/device") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ udid, pointWidth: pts.w, pointHeight: pts.h }));
      return;
    }
    if (req.url === "/api/screenshot") {
      screenshot(udid).then((buf) => {
        res.writeHead(200, { "Content-Type": "image/jpeg" });
        res.end(buf);
      }).catch(() => { res.writeHead(500); res.end(); });
      return;
    }
    serveStatic(req, res);
  });

  const wss = new WebSocketServer({ server, path: "/stream" });
  const clients = new Set<WebSocket>();

  bus.onTyped("frame", ({ data }) => {
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  });

  bus.onTyped("log", (entry) => {
    const msg = JSON.stringify(entry);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("message", (raw) => {
      let evt: InputEvent;
      try {
        evt = JSON.parse(raw.toString()) as InputEvent;
      } catch {
        return;
      }
      markInput();
      handleInput(evt, udid, pts).catch(() => {/* swallow individual input errors */});
    });
    ws.on("close", () => clients.delete(ws));
  });

  startStream(udid);

  await new Promise<void>((resolve, reject) => {
    wss.on("error", reject);
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${config.port} already in use. Try --port=7011`));
      } else {
        reject(err);
      }
    });
    server.listen(config.port, resolve);
  });

  return {
    url: `http://localhost:${config.port}/`,
    udid,
    pointWidth: pts.w,
    pointHeight: pts.h,
    close() {
      server.close();
      wss.close();
    },
  };
}

async function handleInput(
  evt: InputEvent,
  udid: string,
  pts: { w: number; h: number },
): Promise<void> {
  if (evt.type === "tap") {
    await tap(udid, evt.x, evt.y);
  } else if (evt.type === "swipe") {
    await swipe(udid, evt.from, evt.to, evt.durationMs);
  } else if (evt.type === "text") {
    await text(udid, evt.value);
  } else if (evt.type === "button") {
    await button(udid, evt.button);
  } else if (evt.type === "keycode") {
    await keycode(udid, evt.code);
  } else if (evt.type === "openurl") {
    await openUrl(udid, evt.url);
  }
}
