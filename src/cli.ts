#!/usr/bin/env node
import { startServer } from "./server/index.js";
import { runMcp } from "./mcp/index.js";
import { startMetroLogs, startOsLogs } from "./server/logs.js";
import { isAvailable } from "./server/idb.js";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const subcommand = args[0];
const port = parseInt(args.find((a) => a.startsWith("--port="))?.split("=")[1] ?? "7010");
const udid = args.find((a) => a.startsWith("--udid="))?.split("=")[1];

async function doctor(): Promise<void> {
  console.log("claude-ios-simulator doctor\n");

  try {
    const { stdout } = await execa("xcrun", ["simctl", "help"]);
    console.log("✓ xcrun simctl available");
  } catch {
    console.log("✗ xcrun simctl not found — install Xcode Command Line Tools");
  }

  const idbOk = await isAvailable();
  if (idbOk) {
    console.log("✓ idb available");
  } else {
    console.log("✗ idb not found\n  Install: brew install facebook/fb/idb-companion && pip install fb-idb");
  }

  try {
    const { stdout } = await execa("xcrun", ["simctl", "list", "devices", "Booted"]);
    if (stdout.includes("iPhone") || stdout.includes("iPad")) {
      console.log("✓ booted simulator found");
    } else {
      console.log("✗ no booted simulator — run: xcrun simctl boot 'iPhone 15'");
    }
  } catch {
    console.log("✗ could not list simulators");
  }
}

async function setupMcp(scope: "local" | "project" | "user"): Promise<void> {
  // Resolve the entry point: prefer built dist/cli.js, fall back to tsx src/cli.ts
  const distCli = path.resolve(__dirname, "../../dist/cli.js");
  const srcCli = path.resolve(__dirname, "../cli.ts");

  let command: string;
  let cmdArgs: string[];

  if (fs.existsSync(distCli)) {
    command = "node";
    cmdArgs = [distCli, "mcp", `--port=${port}`];
  } else {
    command = "npx";
    cmdArgs = ["tsx", srcCli, "mcp", `--port=${port}`];
  }

  console.log(`Registering MCP server with Claude Code (scope: ${scope})...`);

  try {
    await execa(
      "claude",
      ["mcp", "add", `--scope=${scope}`, "ios-simulator-preview", "--", command, ...cmdArgs],
      { stdio: "inherit" },
    );
    console.log("\n✓ MCP server registered as ios-simulator-preview");
    console.log("  Restart Claude Code, then use: get_preview_url → open in Chrome");
  } catch {
    console.error("✗ Failed — is Claude Code installed? (npm install -g @anthropic-ai/claude-code)");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (subcommand === "doctor") {
    await doctor();
    return;
  }

  if (subcommand === "mcp") {
    await runMcp(port);
    return;
  }

  if (subcommand === "setup") {
    const scope = (args.find((a) => a.startsWith("--scope="))?.split("=")[1] ?? "local") as
      | "local"
      | "project"
      | "user";
    await setupMcp(scope);
    return;
  }

  // default: start preview server
  console.log(`Starting claude-ios-simulator on port ${port}...`);
  const s = await startServer({ port, udid });
  startMetroLogs();
  startOsLogs(s.udid);

  console.log(`\n  Preview URL: ${s.url}`);
  console.log(`  Device UDID: ${s.udid}`);
  console.log(`  Point dimensions: ${s.pointWidth}×${s.pointHeight}\n`);
  console.log("Open the URL in Chrome with the claude-in-chrome extension.\n");
  console.log('Add to .vscode/launch.json → "path": "${s.url}" to let Claude auto-discover it.\n');

  process.on("SIGINT", () => {
    s.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
