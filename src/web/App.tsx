import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return (
    String(d.getHours()).padStart(2, "0") + ":" +
    String(d.getMinutes()).padStart(2, "0") + ":" +
    String(d.getSeconds()).padStart(2, "0") + "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<DeviceInfo | null>(null);
  const imageRef = useRef<HTMLImageElement>(new Image());
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const swipeStartRef = useRef<{ x: number; y: number; ts: number } | null>(null);
  const didSwipeRef = useRef(false);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState("connecting...");
  const [sourceFilter, setSourceFilter] = useState<"all" | "metro" | "os">("all");
  const [textFilter, setTextFilter] = useState("");
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  useEffect(() => {
    fetch("/api/device")
      .then((r) => r.json() as Promise<DeviceInfo>)
      .then((d) => { deviceRef.current = d; })
      .catch(() => {/* use defaults */});
  }, []);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/stream`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus("disconnected");

    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
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

  const filteredLogs = useMemo(
    () =>
      logs.filter(
        (l) =>
          (sourceFilter === "all" || l.source === sourceFilter) &&
          (!textFilter || l.message.toLowerCase().includes(textFilter.toLowerCase())),
      ),
    [logs, sourceFilter, textFilter],
  );

  useLayoutEffect(() => {
    if (stickToBottomRef.current) {
      logsEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [filteredLogs]);

  const handleLogsScroll = useCallback(() => {
    const el = logsContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    stickToBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    setShowScrollBtn(false);
    logsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  const changeSource = useCallback((s: "all" | "metro" | "os") => {
    stickToBottomRef.current = true;
    setShowScrollBtn(false);
    setSourceFilter(s);
  }, []);

  const changeTextFilter = useCallback((v: string) => {
    stickToBottomRef.current = true;
    setShowScrollBtn(false);
    setTextFilter(v);
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
        minWidth: 0,
      }}>
        {/* log panel header */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#555", marginRight: 2 }}>logs</span>
          {(["all", "metro", "os"] as const).map((s) => (
            <button
              key={s}
              onClick={() => changeSource(s)}
              style={{
                background: sourceFilter === s ? "#2a2a2a" : "transparent",
                border: "1px solid " + (sourceFilter === s ? "#555" : "#2a2a2a"),
                borderRadius: 4,
                color: sourceFilter === s ? "#bbb" : "#444",
                cursor: "pointer",
                fontSize: 10,
                padding: "2px 7px",
              }}
            >
              {s}
            </button>
          ))}
          <input
            type="text"
            placeholder="filter..."
            value={textFilter}
            onChange={(e) => changeTextFilter(e.target.value)}
            style={{
              flex: 1,
              minWidth: 60,
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: 4,
              color: "#ccc",
              fontSize: 10,
              padding: "2px 6px",
              outline: "none",
            }}
          />
          {showScrollBtn && (
            <button
              onClick={scrollToBottom}
              title="Scroll to bottom"
              style={{
                background: "#1a1a1a",
                border: "1px solid #2a2a2a",
                borderRadius: 4,
                color: "#888",
                cursor: "pointer",
                fontSize: 10,
                padding: "2px 6px",
              }}
            >
              ↓
            </button>
          )}
          <button
            onClick={() => setLogs([])}
            style={{
              background: "transparent",
              border: "1px solid #2a2a2a",
              borderRadius: 4,
              color: "#444",
              cursor: "pointer",
              fontSize: 10,
              padding: "2px 6px",
            }}
          >
            clear
          </button>
        </div>

        {/* log list */}
        <div
          ref={logsContainerRef}
          onScroll={handleLogsScroll}
          style={{
            flex: 1,
            overflowY: "auto",
            fontFamily: "monospace",
            fontSize: 11,
            lineHeight: 1.6,
          }}
        >
          {filteredLogs.map((l, i) => (
            <div
              key={i}
              style={{
                color: l.source === "metro" ? "#7ec8e3" : "#999",
                display: "flex",
                gap: 6,
                borderBottom: "1px solid #161616",
                padding: "1px 0",
              }}
            >
              <span style={{ color: "#383838", flexShrink: 0 }}>{fmtTs(l.ts)}</span>
              <span style={{ color: l.source === "metro" ? "#3a6a7a" : "#383838", flexShrink: 0 }}>
                [{l.source}]
              </span>
              <span style={{ wordBreak: "break-all" }}>{l.message}</span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
