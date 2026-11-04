/**
 * ServiceOS — Node.js-only instrumentation (imported from ./instrumentation).
 *
 * The deployment sandbox runs the Next.js dev server as a long-lived,
 * platform-managed process, but background processes started from agent shell
 * sessions are reaped when each session ends. To guarantee the REST API
 * (port 4000) and the background worker are always available to the web
 * console, this hook performs an idempotent health check on boot and spawns
 * both processes (detached, logs to /tmp) when the API is not answering.
 *
 * On platform reboots the .zscripts/dev.sh boot chain starts the API first;
 * the health check then passes and nothing is spawned (no double processes).
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, openSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";

const API_DIR = join(process.cwd(), "mini-services", "serviceos-api");

function apiHealthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: 4000, path: "/health/live", timeout: 1500 },
      (res) => {
        resolve((res.statusCode ?? 500) === 200);
        res.resume();
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function ensureApiRunning(): Promise<void> {
  if (await apiHealthy()) return;

  // Load the API's own .env (DATABASE_URL, JWT secrets, storage driver).
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  const envFile = join(API_DIR, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2];
    }
  }

  for (const entry of ["dist/main.js", "dist/worker.js"]) {
    const out = openSync(`/tmp/serviceos-${entry === "dist/main.js" ? "api" : "worker"}.log`, "a");
    const child = spawn(process.execPath, ["--enable-source-maps", entry], {
      cwd: API_DIR,
      env: env as unknown as NodeJS.ProcessEnv,
      detached: true,
      stdio: ["ignore", out, out],
    });
    child.unref();
  }

  // Best-effort readiness wait (max ~20s); never fail Next.js boot.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await apiHealthy()) return;
  }
}

ensureApiRunning().catch(() => {
  /* instrumentation must never take the web console down */
});
