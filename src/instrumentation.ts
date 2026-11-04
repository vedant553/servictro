/**
 * ServiceOS — Next.js instrumentation entry.
 *
 * Keeps the Edge-compatible entry free of Node builtins: the real supervisor
 * lives in ./instrumentation-node and is imported only in the Node.js runtime
 * (the documented Next.js pattern).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
