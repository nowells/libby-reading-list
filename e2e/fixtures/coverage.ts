import { test as base, expect } from "@playwright/test";
import MCR from "monocart-coverage-reports";
// @ts-expect-error — plain ESM helper, not part of the TS project graph.
import { coverageEntryFilter } from "../../scripts/coverage-entry-filter.mjs";

/**
 * Playwright + V8 coverage fixture.
 *
 * Activated only when `COVERAGE=1`. Each test brackets its work with
 * `page.coverage.startJSCoverage` / `stopJSCoverage`, and the entries are
 * handed to a single MCR report instance whose cache lives at
 * `./.coverage-raw/e2e/.cache`. The raw files are emitted by the global
 * teardown's `report.generate()` call, after which scripts/merge-coverage.mjs
 * combines them with the unit raws.
 *
 * `resetOnNavigation: false` is required: Playwright reloads the SPA
 * between actions, and we want a single accumulated coverage trace per test
 * rather than only the entries from the last navigation.
 */

const collectCoverage = process.env.COVERAGE === "1";

const COVERAGE_OUTPUT_DIR = "./.coverage-raw/e2e";

export function createCoverageReport() {
  return MCR({
    name: "E2E (raw)",
    outputDir: COVERAGE_OUTPUT_DIR,
    reports: [["raw", { outputDir: "raw" }]],
    entryFilter: coverageEntryFilter,
    logging: "error",
  });
}

let sharedReport: ReturnType<typeof MCR> | null = null;

function getSharedReport() {
  if (!sharedReport) {
    sharedReport = createCoverageReport();
  }
  return sharedReport;
}

export const test = base.extend<{ collectCoverage: void }>({
  collectCoverage: [
    async ({ page, browserName }, use) => {
      if (!collectCoverage || browserName !== "chromium") {
        await use();
        return;
      }

      await page.coverage.startJSCoverage({ resetOnNavigation: false });

      await use();

      const entries = await page.coverage.stopJSCoverage();
      if (entries.length > 0) {
        await getSharedReport().add(entries);
      }
    },
    { auto: true, scope: "test" },
  ],
});

export { expect };
