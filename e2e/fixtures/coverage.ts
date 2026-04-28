import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import libCoverage from "istanbul-lib-coverage";
import v8toIstanbul from "v8-to-istanbul";

/**
 * Playwright + V8 coverage fixture.
 *
 * Activated only when `COVERAGE=1`. Each test brackets its work with
 * `page.coverage.startJSCoverage` / `stopJSCoverage`, converts entries to
 * istanbul format via `v8-to-istanbul`, and writes a per-test JSON file
 * under `./coverage/e2e/raw/`. Playwright's globalTeardown calls
 * `flushCoverage()` (below) which merges every raw file into
 * `./coverage/e2e/coverage-final.json` so scripts/merge-coverage.mjs can
 * union it with the unit run's coverage-final.json.
 *
 * Per-test files are required because the fixture runs in a worker
 * process while globalTeardown runs in the main process — they don't
 * share memory.
 *
 * `resetOnNavigation: false` keeps a single accumulated trace per test
 * instead of only the entries from the last navigation.
 */

const collectCoverage = process.env.COVERAGE === "1";

const COVERAGE_E2E_DIR = path.resolve("./coverage/e2e");
const COVERAGE_RAW_DIR = path.join(COVERAGE_E2E_DIR, "raw");
const COVERAGE_FINAL_FILE = path.join(COVERAGE_E2E_DIR, "coverage-final.json");

/**
 * Reject vendor and non-source entries (Vite dep pre-bundles, HTML page
 * entries, anything outside `app/{components,lib,routes}/`) so the merged
 * report contains only first-party JS sources. Mirrors the predicate the
 * unit run's V8 provider applies via `coverage.include` / `exclude`.
 */
function shouldKeepEntry(url: string): boolean {
  const cleaned = url.split("?")[0];
  if (!/\/app\/(components|lib|routes)\/.+\.(ts|tsx)$/i.test(cleaned)) return false;
  if (/\.test\.(ts|tsx)$/.test(cleaned)) return false;
  if (/\/app\/test\//.test(cleaned)) return false;
  return true;
}

export async function flushCoverage() {
  let entries: string[];
  try {
    entries = await readdir(COVERAGE_RAW_DIR);
  } catch {
    return;
  }

  const map = libCoverage.createCoverageMap({});
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const data = JSON.parse(await readFile(path.join(COVERAGE_RAW_DIR, name), "utf8"));
    map.merge(data);
  }

  await writeFile(COVERAGE_FINAL_FILE, JSON.stringify(map.toJSON()));
  await rm(COVERAGE_RAW_DIR, { recursive: true, force: true });
}

export const test = base.extend<{ collectCoverage: void }>({
  collectCoverage: [
    async ({ page, browserName, baseURL }, use) => {
      if (!collectCoverage || browserName !== "chromium") {
        await use();
        return;
      }

      await page.coverage.startJSCoverage({ resetOnNavigation: false });

      await use();

      const v8Entries = await page.coverage.stopJSCoverage();
      const origin = baseURL ?? "";
      const map = libCoverage.createCoverageMap({});

      for (const entry of v8Entries) {
        if (!shouldKeepEntry(entry.url)) continue;

        // Strip the dev server origin so the istanbul map keys line up
        // with the unit run's filesystem paths.
        const relative = entry.url.replace(origin, "").split("?")[0];
        const absolute = path.resolve("." + relative);

        const converter = v8toIstanbul(
          absolute,
          0,
          entry.source ? { source: entry.source } : undefined,
        );
        try {
          await converter.load();
          converter.applyCoverage(entry.functions);
          map.merge(converter.toIstanbul());
        } catch {
          // Sources missing on disk (e.g. virtual modules) — skip silently;
          // they would have been filtered out anyway.
        } finally {
          converter.destroy();
        }
      }

      const json = map.toJSON();
      if (Object.keys(json).length === 0) return;

      await mkdir(COVERAGE_RAW_DIR, { recursive: true });
      await writeFile(path.join(COVERAGE_RAW_DIR, `${randomUUID()}.json`), JSON.stringify(json));
    },
    { auto: true, scope: "test" },
  ],
});

export { expect };
