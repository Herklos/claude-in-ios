import React, { useCallback, useEffect, useRef, useState } from "react";

interface DeviceInfo {
  udid: string;
  pointWidth: number;
  pointHeight: number;
}

interface LogEntry {
  type: "log";
  source: "metro" | "os";
  ts: number;
  message: string;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<DeviceInfo | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState("connecting...");
  const imageRef = useRef<HTMLImageElement>(new Image());

  // fetch device metadata once
  useEffect(() => {
    fetch("/api/device")
      .then((r) => r.json() as Promise<DeviceInfo>)
      .then((d) => { deviceRef.current = d; })
      .catch(() => {/* use defaults */});
  }, []);

  // websocket for frames + logs
  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/stream`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus("disconnected");

    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        // binary = JPEG frame
        const blob = new Blob([evt.data], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        const img = imageRef.current;
        img.onload = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext("2d")?.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
        };
        img.src = url;
      } else {
        // text = log entry
        try {
          const entry = JSON.parse(evt.data as string) as LogEntry;
          if (entry.type === "log") {
            setLogs((prev) => [...prev.slice(-499), entry]);
          }
        } catch {/* ignore malformed */}
      }
    };

    return () => ws.close();
  }, []);

  const sendInput = useCallback((msg: object) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  const canvasToPoint = useCallback((
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const pxX = (clientX - rect.left) * scaleX;
    const pxY = (clientY - rect.top) * scaleY;

    const dev = deviceRef.current;
    if (!dev || canvas.width === 0) return { x: pxX, y: pxY };
    return {
      x: Math.round((pxX / canvas.width) * dev.pointWidth),
      y: Math.round((pxY / canvas.height) * dev.pointHeight),
    };
  }, []);

  const swipeStartRef = useRef<{ x: number; y: number; ts: number } | null>(null);
  const didSwipeRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y } = canvasToPoint(canvas, e.clientX, e.clientY);
    swipeStartRef.current = { x, y, ts: Date.now() };
    didSwipeRef.current = false;
  }, [canvasToPoint]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !swipeStartRef.current) return;
    const { x, y } = canvasToPoint(canvas, e.clientX, e.clientY);
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    const dist = Math.hypot(x - start.x, y - start.y);
    if (dist > 10) {
      didSwipeRef.current = true;
      sendInput({ type: "swipe", from: [start.x, start.y], to: [x, y], durationMs: Date.now() - start.ts });
    }
  }, [canvasToPoint, sendInput]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (didSwipeRef.current) { didSwipeRef.current = false; return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y } = canvasToPoint(canvas, e.clientX, e.clientY);
    sendInput({ type: "tap", x, y });
  }, [canvasToPoint, sendInput]);

  const btn = (label: string, title: string, onClick: () => void) => (
    <button
      key={label}
      title={title}
      onClick={onClick}
      style={{
        background: "#222",
        border: "1px solid #444",
        borderRadius: 6,
        color: "#ccc",
        cursor: "pointer",
        fontSize: 16,
        padding: "6px 10px",
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "row", height: "100vh", gap: 8, padding: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#888" }}>
          {status} — click to tap, drag to swipe
        </span>
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          style={{
            border: "1px solid #333",
            borderRadius: 12,
            cursor: "crosshair",
            maxHeight: "calc(100vh - 112px)",
            width: "auto",
            objectFit: "contain",
          }}
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          {btn("⊙", "Home",        () => sendInput({ type: "button", button: "HOME" }))}
          {btn("⏻", "Lock / Sleep", () => sendInput({ type: "button", button: "LOCK" }))}
          {btn("◻", "Side button", () => sendInput({ type: "button", button: "SIDE_BUTTON" }))}
          {btn("🔊", "Volume up",  () => sendInput({ type: "keycode", code: 128 }))}
          {btn("🔉", "Volume down",() => sendInput({ type: "keycode", code: 129 }))}
          {btn("◎", "Siri",        () => sendInput({ type: "button", button: "SIRI" }))}
          {btn("⊡", "Apple Pay",   () => sendInput({ type: "button", button: "APPLE_PAY" }))}
        </div>
      </div>

      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#111",
        borderRadius: 8,
        padding: 8,
        overflow: "hidden",
      }}>
        <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>logs</div>
        <div style={{
          flex: 1,
          overflowY: "auto",
          fontSize: 11,
          lineHeight: 1.5,
        }}>
          {logs.map((l, i) => (
            <div key={i} style={{ color: l.source === "metro" ? "#7ec8e3" : "#aaa" }}>
              <span style={{ color: "#555" }}>[{l.source}]</span> {l.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
