#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const { values: cliArgs } = parseArgs({
  options: {
    port:     { type: "string", short: "p" },
    hostname: { type: "string", short: "H" },
    open:     { type: "boolean", default: true },
    "no-open": { type: "boolean", default: false },
    dev:      { type: "boolean", default: false },
  },
  strict: false,
  allowPositionals: true,
});

const port     = cliArgs.port     ?? process.env.PORT     ?? "30141";
const hostname = cliArgs.hostname ?? process.env.PI_WEB_HOSTNAME ?? process.env.HOSTNAME ?? null;
const shouldOpenBrowser = cliArgs.open !== false && cliArgs.open !== "false" && cliArgs["no-open"] !== true;
const isDev = cliArgs.dev === true;
const isTermux = Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes("/com.termux/"));

if (!isDev && !fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Run `pi-web --dev` from a source checkout, or install the published package.");
  process.exit(1);
}

const nextArgs = [isDev ? "dev" : "start", "-p", port];
if (isDev) nextArgs.push("--webpack");
if (hostname) nextArgs.push("-H", hostname);

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env },
});

let browserOpened = false;
const displayHost = hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : (hostname ?? "localhost");
const url = `http://${displayHost}:${port}`;

function openBrowser(url) {
  if (isTermux) {
    // Termux:API provides termux-open-url; Android's am command is the fallback.
    const opener = spawn("sh", ["-c", "command -v termux-open-url >/dev/null 2>&1 && termux-open-url \"$1\" || am start -a android.intent.action.VIEW -d \"$1\" >/dev/null", "sh", url], {
      stdio: "ignore",
      detached: true,
    });
    opener.on("error", (error) => console.warn(`Could not open browser automatically: ${error.message}`));
    opener.unref();
    return;
  }

  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
  const opener = spawn(openCmd, [url], {
    shell: isWindows,
    stdio: "ignore",
    detached: true,
  });

  opener.on("error", (error) => {
    console.warn(`Could not open browser automatically: ${error.message}`);
  });

  opener.unref();
}

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (shouldOpenBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    openBrowser(url);
  }
});

child.on("exit", (code) => process.exit(code ?? 0));
