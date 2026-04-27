// monocart-coverage-reports config — auto-loaded by vitest-monocart-coverage
// during `vitest run --coverage`. Writes raw V8 entries to .coverage-raw/unit
// so scripts/merge-coverage.mjs can combine them with the e2e raws.
//
// The merge script and the e2e fixture instantiate MCR directly with inline
// options, so this file only governs the Vitest unit run.
//
// Important: filtering happens at this stage, not in the merge step. MCR's
// `inputDir` mode does not re-apply `entryFilter`/`sourceFilter`, so each
// pipeline must trim its own raws before they hit disk.

import { coverageEntryFilter } from "./scripts/coverage-entry-filter.mjs";

export default {
  name: "Unit (raw)",
  outputDir: "./.coverage-raw/unit",
  reports: [["raw", { outputDir: "raw" }]],
  cleanCache: true,
  entryFilter: coverageEntryFilter,
  logging: "error",
};
