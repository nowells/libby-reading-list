#!/usr/bin/env node
/**
 * Merge unit + e2e coverage into a unified report.
 *
 * Inputs:
 *   coverage/unit/coverage-final.json   (written by @vitest/coverage-v8)
 *   coverage/e2e/coverage-final.json    (written by e2e/fixtures/coverage.ts)
 *
 * Output:
 *   coverage/                            (text + lcov + html + json-summary)
 *
 * Thresholds mirror the previous setup; merging in e2e coverage should only
 * push the numbers up. If a threshold fails, exit code is 1.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";

const THRESHOLDS = {
  lines: 55,
  functions: 48,
  branches: 50,
  statements: 53,
};

const inputs = [
  path.resolve("coverage/unit/coverage-final.json"),
  path.resolve("coverage/e2e/coverage-final.json"),
].filter((p) => existsSync(p));

if (inputs.length === 0) {
  console.error(
    "[merge-coverage] no coverage-final.json inputs found; run unit and e2e with coverage first.",
  );
  process.exit(1);
}

const map = libCoverage.createCoverageMap({});
for (const file of inputs) {
  map.merge(JSON.parse(readFileSync(file, "utf8")));
}

const context = libReport.createContext({
  dir: "coverage",
  defaultSummarizer: "nested",
  coverageMap: map,
});

for (const reporter of ["text", "lcov", "html", "json-summary"]) {
  reports.create(reporter, { skipFull: false }).execute(context);
}

const summary = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8")).total;
const failures = [];
for (const [metric, min] of Object.entries(THRESHOLDS)) {
  const pct = summary[metric]?.pct;
  if (typeof pct !== "number") continue;
  if (pct < min) failures.push(`  ${metric}: ${pct.toFixed(2)}% < ${min}% (threshold)`);
}

if (failures.length > 0) {
  console.error(`\n[merge-coverage] threshold check failed:\n${failures.join("\n")}\n`);
  process.exitCode = 1;
}
