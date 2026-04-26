import { AtpAgent } from "@atproto/api";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const LEXICON_DIR = resolve(import.meta.dirname, "../public/lexicons");
const LEXICON_COLLECTION = "com.atproto.lexicon.schema";

const handle = process.env.ATPROTO_HANDLE;
const password = process.env.ATPROTO_APP_PASSWORD;
const service = process.env.ATPROTO_PDS ?? "https://bsky.social";

if (!handle || !password) {
  console.error(
    "Missing credentials. Set ATPROTO_HANDLE and ATPROTO_APP_PASSWORD " +
      "(create one at https://bsky.app/settings/app-passwords). " +
      "Optionally set ATPROTO_PDS (defaults to https://bsky.social).",
  );
  process.exit(1);
}

interface LexiconDoc {
  lexicon: number;
  id: string;
  [key: string]: unknown;
}

function loadLexicons(): LexiconDoc[] {
  return readdirSync(LEXICON_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const raw = readFileSync(resolve(LEXICON_DIR, name), "utf-8");
      const doc = JSON.parse(raw) as LexiconDoc;
      if (typeof doc.id !== "string" || doc.id.length === 0) {
        throw new Error(`${name} is missing a top-level "id" field`);
      }
      return doc;
    });
}

const agent = new AtpAgent({ service });
await agent.login({ identifier: handle, password });

const did = agent.session?.did;
if (!did) {
  throw new Error("Login succeeded but no DID was returned");
}

const lexicons = loadLexicons();
console.log(`Publishing ${lexicons.length} lexicon(s) to ${did} on ${service}`);

for (const doc of lexicons) {
  const record = { ...doc, $type: LEXICON_COLLECTION };
  const res = await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: LEXICON_COLLECTION,
    rkey: doc.id,
    record,
  });
  console.log(`  ${doc.id} -> ${res.data.uri}`);
}

console.log("Done.");
console.log("\nNext: add this DNS TXT record at the shelfcheck.org registrar.");
console.log(`  _lexicon.shelfcheck.org  TXT  "did=${did}"`);
