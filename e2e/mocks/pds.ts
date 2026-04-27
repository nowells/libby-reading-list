import type { Page, Route } from "@playwright/test";
import { TEST_PDS_ORIGIN } from "./catalog";
import type { PdsRecord } from "./types";

/**
 * In-memory PDS that persists across page reloads (the store lives in
 * the test process, not the page) so tests can sign out, sign back in,
 * and observe that the records are still there.
 *
 * Records are organised as:
 *   collection NSID  ->  rkey  ->  PdsRecord
 *
 * The store also exposes a tiny "did:plc:foo" namespace because the
 * setup page calls `app.bsky.actor.getProfile` against the PDS via the
 * test session's fetchHandler.
 */
export class MockPds {
  /** repo did -> collection -> rkey -> record */
  readonly repos = new Map<string, Map<string, Map<string, PdsRecord>>>();
  /** did -> handle, looked up by getProfile. */
  readonly profiles = new Map<string, { did: string; handle: string }>();

  upsertProfile(did: string, handle: string) {
    this.profiles.set(did, { did, handle });
  }

  /** Total number of records in the supplied repo + collection. */
  countRecords(did: string, collection: string): number {
    return this.repos.get(did)?.get(collection)?.size ?? 0;
  }

  /** Snapshot all records for a repo + collection (rkey -> value). */
  recordsFor(did: string, collection: string): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    const records = this.repos.get(did)?.get(collection);
    if (!records) return out;
    for (const [rkey, rec] of records) out[rkey] = rec.value;
    return out;
  }

  reset() {
    this.repos.clear();
    this.profiles.clear();
  }

  private ensureRepo(did: string, collection: string): Map<string, PdsRecord> {
    let repo = this.repos.get(did);
    if (!repo) {
      repo = new Map();
      this.repos.set(did, repo);
    }
    let coll = repo.get(collection);
    if (!coll) {
      coll = new Map();
      repo.set(collection, coll);
    }
    return coll;
  }

  private buildUri(did: string, collection: string, rkey: string) {
    return `at://${did}/${collection}/${rkey}`;
  }

  async handleListRecords(route: Route) {
    const url = new URL(route.request().url());
    const did = url.searchParams.get("repo") ?? "";
    const collection = url.searchParams.get("collection") ?? "";
    const records = this.repos.get(did)?.get(collection);
    const out = records
      ? Array.from(records.values()).map((r) => ({ uri: r.uri, cid: r.cid, value: r.value }))
      : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ records: out }),
    });
  }

  async handleCreateRecord(route: Route) {
    const body = (await route.request().postDataJSON()) as {
      repo: string;
      collection: string;
      rkey?: string;
      record: Record<string, unknown>;
    };
    const rkey = body.rkey ?? this.tid();
    const coll = this.ensureRepo(body.repo, body.collection);
    const uri = this.buildUri(body.repo, body.collection, rkey);
    const cid = makeFakeCid(`${body.collection}/${rkey}`);
    coll.set(rkey, { uri, cid, value: body.record });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ uri, cid }),
    });
  }

  async handlePutRecord(route: Route) {
    const body = (await route.request().postDataJSON()) as {
      repo: string;
      collection: string;
      rkey: string;
      record: Record<string, unknown>;
    };
    const coll = this.ensureRepo(body.repo, body.collection);
    const uri = this.buildUri(body.repo, body.collection, body.rkey);
    const version = coll.get(body.rkey)?.cid ? "v2" : "v1";
    const cid = makeFakeCid(`${body.collection}/${body.rkey}/${version}`);
    coll.set(body.rkey, { uri, cid, value: body.record });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ uri, cid }),
    });
  }

  async handleDeleteRecord(route: Route) {
    const body = (await route.request().postDataJSON()) as {
      repo: string;
      collection: string;
      rkey: string;
    };
    this.repos.get(body.repo)?.get(body.collection)?.delete(body.rkey);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  }

  async handleGetProfile(route: Route) {
    const url = new URL(route.request().url());
    const actor = url.searchParams.get("actor") ?? "";
    const profile = this.profiles.get(actor) ?? { did: actor, handle: "unknown.test" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        did: profile.did,
        handle: profile.handle,
        displayName: profile.handle,
      }),
    });
  }

  /** Generate a strictly-increasing record key. */
  private nextTid = 0;
  private tid(): string {
    this.nextTid += 1;
    return `tid${Date.now()}${this.nextTid}`;
  }
}

/**
 * Pool of real, parseable CIDs to use in mock responses. The XRPC
 * client validates the `cid` field against the lexicon's "cid" format,
 * which calls `multiformats CID.parse()` under the hood — no
 * synthesised string survives that check. We rotate through a pool
 * so different records get different CIDs (tests never inspect them).
 */
const CID_POOL = [
  "bafyreigbpv3a73ykdmqvyahgs6jhmsumvzaaffj3o4f5wsbsudvxefukm4",
  "bafyreih5quzyrr2sxhulxbfdsfsffuvopcmuwhrcatkkbatfeyxehuvwue",
  "bafyreif5e3jyfzd6gffjg2cidcz66ymvjudg6lqdvg5jmoo3fpx5l45oym",
  "bafyreiao7gv7g457ygmxz4nf3eajavjbexldjyvmttypjzkcumshyiq6cy",
  "bafyreid27zk7lgb53qrxhdsi3o4n2pmh4txqxnmxfx3utfu6r6w2dmd2pa",
];

function makeFakeCid(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
  }
  return CID_POOL[Math.abs(hash) % CID_POOL.length];
}

/**
 * Wire all PDS XRPC routes through the supplied store. Returns the store
 * so tests can preload records or assert on the final state.
 *
 * We use regex matchers rather than Playwright's glob syntax because the
 * glob's `?` and `*` semantics conflict with the literal `?` that
 * separates URL paths from query strings in XRPC GET endpoints.
 */
export async function installPdsRoutes(page: Page, pds: MockPds): Promise<MockPds> {
  const origin = escapeRegex(TEST_PDS_ORIGIN);
  // Catch-all for any XRPC namespace we haven't implemented (e.g.
  // buzz.bookhive.book during the first-sign-in BookHive import).
  // Playwright matches routes in reverse order of registration, so
  // registering the catch-all FIRST means specific routes below take
  // precedence. Returning an empty record list keeps the app happy.
  await page.route(new RegExp(`^${origin}/xrpc/`), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ records: [] }),
    }),
  );
  await page.route(
    new RegExp(`^${origin}/xrpc/com\\.atproto\\.repo\\.listRecords(\\?|$)`),
    (route) => pds.handleListRecords(route),
  );
  await page.route(new RegExp(`^${origin}/xrpc/com\\.atproto\\.repo\\.createRecord$`), (route) =>
    pds.handleCreateRecord(route),
  );
  await page.route(new RegExp(`^${origin}/xrpc/com\\.atproto\\.repo\\.putRecord$`), (route) =>
    pds.handlePutRecord(route),
  );
  await page.route(new RegExp(`^${origin}/xrpc/com\\.atproto\\.repo\\.deleteRecord$`), (route) =>
    pds.handleDeleteRecord(route),
  );
  await page.route(new RegExp(`^${origin}/xrpc/app\\.bsky\\.actor\\.getProfile(\\?|$)`), (route) =>
    pds.handleGetProfile(route),
  );
  return pds;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
