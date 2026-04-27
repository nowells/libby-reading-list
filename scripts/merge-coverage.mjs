#!/usr/bin/env node
/**
 * Merge unit + e2e raw V8 coverage into one report.
 *
 * Inputs:
 *   .coverage-raw/unit/raw   (written by vitest-monocart-coverage)
 *   .coverage-raw/e2e/raw    (written by Playwright fixture + globalTeardown)
 *
 * Output:
 *   coverage/                (text + lcov + json-summary + v8 html)
 *
 * Thresholds mirror the previous Vitest-only setup; merging in e2e coverage
 * should only push the numbers up. If a threshold fails, exit code is 1.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import MCR from "monocart-coverage-reports";

const THRESHOLDS = {
  lines: 55,
  functions: 48,
  branches: 50,
  statements: 53,
};

const inputDir = [
  path.resolve(".coverage-raw/unit/raw"),
  path.resolve(".coverage-raw/e2e/raw"),
].filter((dir) => existsSync(dir));

if (inputDir.length === 0) {
  console.error(
    "[merge-coverage] no raw coverage inputs found; run unit and e2e with coverage first.",
  );
  process.exit(1);
}

const report = MCR({
  name: "Unified Coverage",
  inputDir,
  outputDir: "./coverage",
  reports: [
    ["v8"],
    ["lcov"],
    ["json-summary"],
    ["text", { skipFull: false }],
    ["console-summary"],
  ],
  cleanCache: true,
  // No entry/source filter here: MCR's `inputDir` merge does not re-apply
  // `entryFilter`, so the unit and e2e pipelines do their own filtering
  // before writing raws (see scripts/coverage-entry-filter.mjs). Anything
  // that reaches this point is already first-party app source.
  logging: "info",
  onEnd: (results) => {
    if (!results) return;
    const summary = results.summary ?? {};
    const failures = [];
    for (const [metric, min] of Object.entries(THRESHOLDS)) {
      const pct = summary[metric]?.pct;
      if (typeof pct !== "number") continue;
      if (pct < min) {
        failures.push(
          `  ${metric}: ${pct.toFixed(2)}% < ${min}% (threshold)`,
        );
      }
    }
    if (failures.length > 0) {
      console.error(
        `\n[merge-coverage] threshold check failed:\n${failures.join("\n")}\n`,
      );
      process.exitCode = 1;
    }
  },
});

await report.generate();
