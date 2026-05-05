/**
 * Publish a merged PR's Changelog block to standard.site.
 *
 * Reads the PR body, extracts the `## Changelog` YAML block (per the
 * changelog-entry skill), and unless `category: skip` writes a
 * `site.standard.document` record to the configured PDS via
 * `com.atproto.repo.putRecord`. The rkey is `pr-<number>`, so re-runs of
 * the same PR upsert the same record (idempotent).
 *
 * Designed to run from .github/workflows/changelog-publish.yml on
 * `pull_request: closed` with `merged == true`.
 *
 * Required env:
 *   ATPROTO_HANDLE          PDS account handle (e.g. shelfcheck.bsky.social)
 *   ATPROTO_APP_PASSWORD    app password for the handle
 *
 * Optional env:
 *   ATPROTO_PDS              PDS service URL (default https://bsky.social)
 *   STANDARD_PUBLICATION_URI at:// URI of the site.standard.publication
 *                            record. When set, the document references it.
 *   CHANGELOG_PATH_PREFIX    URL path prefix on the publication
 *                            (default "/changelog")
 *
 * Required flags:
 *   --body-file <path> | --body-env <name>
 *   --pr-number <n>     PR number (used for rkey + path)
 *   --pr-url <url>      PR URL (stored on the record as `source`)
 *   --merged-at <iso>   PR merged_at timestamp
 *
 * Exit codes:
 *   0  published, or skip-entry was logged
 *   1  missing creds / publish failed
 *   2  changelog block missing or invalid (the lint job should have
 *      blocked the PR; treat as hard error here)
 */

import { AtpAgent } from "@atproto/api";
import { extract, readBody } from "./lib/changelog.ts";

const DOCUMENT_COLLECTION = "site.standard.document";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const prNumber = flag("--pr-number");
const prUrl = flag("--pr-url");
const mergedAt = flag("--merged-at");

if (!prNumber || !prUrl || !mergedAt) {
  console.error(
    "Missing required flags. Required: --pr-number, --pr-url, --merged-at, " +
      "and one of --body-file/--body-env/--body.",
  );
  process.exit(1);
}

const handle = process.env.ATPROTO_HANDLE;
const password = process.env.ATPROTO_APP_PASSWORD;
const service = process.env.ATPROTO_PDS ?? "https://bsky.social";
const publicationUri = process.env.STANDARD_PUBLICATION_URI;
const pathPrefix = process.env.CHANGELOG_PATH_PREFIX ?? "/changelog";

if (!handle || !password) {
  console.error(
    "Missing credentials. Set ATPROTO_HANDLE and ATPROTO_APP_PASSWORD " +
      "(create an app password at https://bsky.app/settings/app-passwords).",
  );
  process.exit(1);
}

const body = readBody(process.argv.slice(2));
const result = extract(body);
if (!result.ok) {
  console.error("Changelog block invalid:");
  for (const err of result.errors) console.error(`  - ${err}`);
  console.error("\nThe lint job should have blocked this PR before merge.");
  process.exit(2);
}

const entry = result.entry;

if (entry.category === "skip") {
  console.log(`PR #${prNumber}: category=skip, not publishing.`);
  console.log(`  reason: ${entry.body}`);
  process.exit(0);
}

const slug = slugify(entry.title ?? "post");
const rkey = `pr-${prNumber}`;
const path = `${pathPrefix.replace(/\/+$/, "")}/${prNumber}-${slug}`;

// Field selection follows the documented site.standard.document shape:
// title, path, content (markdown), textContent (plain), publishedAt, tags.
// `source` and `publication` are extra-but-tolerated fields the lexicon's
// "open record" model accepts; downstream renderers can ignore them.
const record: Record<string, unknown> = {
  $type: DOCUMENT_COLLECTION,
  title: entry.title,
  path,
  content: entry.body,
  textContent: entry.body,
  tags: dedupe(["changelog", entry.category, ...entry.tags]),
  publishedAt: mergedAt,
  createdAt: mergedAt,
  source: prUrl,
};
if (publicationUri) {
  record.publication = { uri: publicationUri };
}

const agent = new AtpAgent({ service });
await agent.login({ identifier: handle, password });

const did = agent.session?.did;
if (!did) throw new Error("Login succeeded but no DID was returned");

console.log(`Publishing changelog for PR #${prNumber} to ${did} on ${service}`);
console.log(`  collection : ${DOCUMENT_COLLECTION}`);
console.log(`  rkey       : ${rkey}`);
console.log(`  path       : ${path}`);
console.log(`  title      : ${entry.title}`);
console.log(`  category   : ${entry.category}`);
console.log(`  tags       : ${(record.tags as string[]).join(", ")}`);
if (publicationUri) console.log(`  publication: ${publicationUri}`);

const res = await agent.com.atproto.repo.putRecord({
  repo: did,
  collection: DOCUMENT_COLLECTION,
  rkey,
  record,
});
console.log(`Published: ${res.data.uri}`);

function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return out === "" ? "post" : out;
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
