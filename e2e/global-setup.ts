import { rm } from "node:fs/promises";

/**
 * When COVERAGE=1, wipe the per-run e2e raw dir so stale entries from a
 * previous run can't leak into the merged report. The unit raws are cleaned
 * by MCR itself via `cleanCache: true` in mcr.config.js.
 */
export default async function globalSetup() {
  if (process.env.COVERAGE !== "1") {
    return;
  }

  await rm("./.coverage-raw/e2e", { recursive: true, force: true });
}
