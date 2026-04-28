import { flushCoverage } from "./fixtures/coverage";

/**
 * Persist the e2e coverage map to disk after all tests finish. The fixture
 * accumulates istanbul-format coverage in memory; this writes a single
 * `coverage/e2e/coverage-final.json` for scripts/merge-coverage.mjs.
 */
export default async function globalTeardown() {
  if (process.env.COVERAGE !== "1") return;
  await flushCoverage();
}
