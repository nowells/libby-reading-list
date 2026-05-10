/**
 * Lint a PR description's `## Changelog` block.
 *
 * Used by .github/workflows/changelog-lint.yml as the gate that ensures
 * every PR carries either a valid consumer-readable entry (per the
 * changelog-entry skill) or an explicit `category: skip` block.
 *
 * Usage:
 *   node --experimental-strip-types scripts/lint-changelog.ts --body-file pr.md
 *   node --experimental-strip-types scripts/lint-changelog.ts --body-env PR_BODY
 *   gh pr view 23 --json body --jq .body \
 *     | node --experimental-strip-types scripts/lint-changelog.ts
 *
 * Exit codes:
 *   0  valid entry (including skip)
 *   1  invalid or missing block
 */

import { extract, readBody } from "./lib/changelog.ts";

const body = readBody(process.argv.slice(2));
const result = extract(body);

if (!result.ok) {
  console.error("Changelog block invalid:");
  for (const err of result.errors) console.error(`  - ${err}`);
  console.error("");
  console.error("Every PR must include a `## Changelog` YAML block.");
  console.error("See .claude/skills/changelog-entry/SKILL.md for the format and examples.");
  console.error("If this PR has zero user impact, use `category: skip` with a one-line reason.");
  process.exit(1);
}

const entry = result.entry;
if (entry.category === "skip") {
  console.log(`changelog: skip — ${entry.body}`);
} else {
  console.log(`changelog: ${entry.category} — ${entry.title}`);
  if (entry.tags.length > 0) console.log(`  tags: ${entry.tags.join(", ")}`);
}
