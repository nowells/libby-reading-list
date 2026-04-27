import { createCoverageReport } from "./fixtures/coverage";

/**
 * Flush the e2e raw V8 entries to disk after every test has finished. The
 * fixture only calls `report.add()`, which buffers in MCR's cache; the raw
 * report files are not written until `generate()` runs.
 */
export default async function globalTeardown() {
  if (process.env.COVERAGE !== "1") {
    return;
  }

  await createCoverageReport().generate();
}
