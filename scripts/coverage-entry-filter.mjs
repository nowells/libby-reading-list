/**
 * Shared `entryFilter` predicate for monocart-coverage-reports.
 *
 * Both the Vitest unit run (via mcr.config.js) and the Playwright e2e run
 * (via e2e/fixtures/coverage.ts) hand raw V8 entries to MCR. Vendor and
 * non-source entries (Vite dep pre-bundles, HTML page entries, anything
 * outside `app/{components,lib,routes}/`) get rejected here so the
 * downstream raw files contain only first-party JS sources.
 *
 * Filtering at this stage (rather than in scripts/merge-coverage.mjs) is
 * required because MCR's `inputDir` merge path skips `entryFilter`.
 */

export function coverageEntryFilter(entry) {
  const url = (entry.url || "").split("?")[0];
  if (!/\/app\/(components|lib|routes)\/.+\.(ts|tsx)$/i.test(url)) {
    return false;
  }
  if (/\.test\.(ts|tsx)$/.test(url)) return false;
  if (/\/app\/test\//.test(url)) return false;
  return true;
}
