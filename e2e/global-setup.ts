import { rm } from "node:fs/promises";

/**
 * When COVERAGE=1, wipe the e2e coverage output dir so stale entries from
 * a previous run can't leak into the merged report. The unit coverage dir
 * is cleaned by @vitest/coverage-v8's `cleanOnRerun` default.
 */
export default async function globalSetup() {
  if (process.env.COVERAGE !== "1") return;
  await rm("./coverage/e2e", { recursive: true, force: true });
}
