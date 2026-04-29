import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { NSID, type ShelfEntryRecord, type AuthorFollowRecord } from "./lexicon";

const PLCDIR = "https://plc.directory";

/**
 * Relay used for network-wide collection enumeration. Bluesky's public relay
 * implements the optional `com.atproto.sync.listReposByCollection` endpoint.
 * Exported for tests.
 */
export const RELAY_HOST = "https://relay1.us-east.bsky.network";

export interface FriendProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export interface FriendShelf {
  profile: FriendProfile;
  entries: ShelfEntryRecord[];
  authors: AuthorFollowRecord[];
}

/**
 * Get the authenticated user's Bluesky follows.
 */
async function getFollows(session: OAuthSession): Promise<FriendProfile[]> {
  const agent = new Agent(session);
  const follows: FriendProfile[] = [];
  let cursor: string | undefined;

  do {
    const res = await agent.app.bsky.graph.getFollows({
      actor: session.did,
      limit: 100,
      cursor,
    });
    for (const f of res.data.follows) {
      follows.push({
        did: f.did,
        handle: f.handle,
        displayName: f.displayName,
        avatar: f.avatar,
      });
    }
    cursor = res.data.cursor;
  } while (cursor);

  return follows;
}

/**
 * Resolve a DID to its PDS service endpoint.
 * Handles both did:plc (via plc.directory) and did:web (via .well-known).
 */
async function resolvePds(did: string): Promise<string | null> {
  try {
    const docUrl = did.startsWith("did:web:")
      ? `https://${did.slice("did:web:".length)}/.well-known/did.json`
      : `${PLCDIR}/${did}`;
    const res = await fetch(docUrl);
    if (!res.ok) return null;
    const doc = await res.json();
    const services = doc.service as
      | { id: string; type: string; serviceEndpoint: string }[]
      | undefined;
    const pds = services?.find(
      (s: { id: string; type: string }) =>
        s.id === "#atproto_pds" && s.type === "AtprotoPersonalDataServer",
    );
    return pds?.serviceEndpoint ?? null;
  } catch {
    return null;
  }
}

/**
 * Persistent cache of DID → PDS endpoint. PDS migrations are rare, so we keep
 * resolutions for 30 days; the in-memory map below dedups within a single run.
 *
 * Exported for tests.
 */
export const PDS_CACHE_KEY = "shelfcheck:pds-cache";
export const PDS_CACHE_VERSION = 1;
const PDS_CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30 days

interface PdsCacheEntry {
  pds: string;
  fetchedAt: number;
}

interface PdsCache {
  version: number;
  entries: Record<string, PdsCacheEntry>;
}

function readPdsCache(): PdsCache {
  try {
    const raw = localStorage.getItem(PDS_CACHE_KEY);
    if (!raw) return { version: PDS_CACHE_VERSION, entries: {} };
    const parsed = JSON.parse(raw) as PdsCache;
    if (parsed.version !== PDS_CACHE_VERSION) {
      return { version: PDS_CACHE_VERSION, entries: {} };
    }
    return parsed;
  } catch {
    return { version: PDS_CACHE_VERSION, entries: {} };
  }
}

function getCachedPds(did: string): string | null {
  const cache = readPdsCache();
  const entry = cache.entries[did];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > PDS_CACHE_MAX_AGE) return null;
  return entry.pds;
}

function setCachedPds(did: string, pds: string): void {
  try {
    const cache = readPdsCache();
    cache.entries[did] = { pds, fetchedAt: Date.now() };
    localStorage.setItem(PDS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota / unavailable storage
  }
}

/** In-memory dedup so a single discovery run never resolves the same DID twice. */
const pdsRunCache = new Map<string, string | null>();

/** Test-only: drop the in-memory dedup map so tests start with a clean slate. */
export function _resetPdsRunCacheForTests(): void {
  pdsRunCache.clear();
}

async function getPds(did: string): Promise<string | null> {
  if (pdsRunCache.has(did)) return pdsRunCache.get(did)!;

  const cached = getCachedPds(did);
  if (cached) {
    pdsRunCache.set(did, cached);
    return cached;
  }

  const pds = await resolvePds(did);
  pdsRunCache.set(did, pds);
  // Only persist successful resolutions — null means resolution failed and
  // we should retry on the next page load.
  if (pds) setCachedPds(did, pds);
  return pds;
}

/**
 * List records from a collection on a user's PDS.
 * Queries the user's PDS directly (resolved from their DID doc).
 *
 * When `limit` is omitted we page through every record using the cursor
 * the PDS hands back; the page size hard-caps at 100 (the XRPC max).
 * Friends with large shelves shouldn't get truncated to a single page.
 */
async function listPdsRecords<T>(
  did: string,
  collection: string,
  opts?: { limit?: number },
): Promise<T[]> {
  const pds = await getPds(did);
  if (!pds) return [];

  const limit = opts?.limit ?? Infinity;
  const out: T[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set("repo", did);
    url.searchParams.set("collection", collection);
    url.searchParams.set("limit", String(Math.min(limit - out.length, 100)));
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString());
    if (!res.ok) break;
    const data = await res.json();
    for (const r of data.records ?? []) {
      out.push(r.value as T);
    }
    cursor = data.cursor;
  } while (cursor && out.length < limit);

  return out;
}

/**
 * Check if a user has any org.shelfcheck.shelf.entry records (i.e. uses ShelfCheck).
 * Queries the user's PDS directly.
 */
async function listUserShelfEntries(
  did: string,
  opts?: { limit?: number },
): Promise<ShelfEntryRecord[]> {
  return listPdsRecords<ShelfEntryRecord>(did, NSID.shelfEntry, opts);
}

/**
 * List a user's followed authors from their PDS.
 */
async function listUserAuthors(did: string): Promise<AuthorFollowRecord[]> {
  return listPdsRecords<AuthorFollowRecord>(did, NSID.authorFollow);
}

/**
 * Fetch a single friend's shelf entries and followed authors.
 * Returns null if the user no longer has any shelf entries.
 */
export async function fetchFriendShelf(
  profile: FriendProfile,
  opts?: { signal?: AbortSignal },
): Promise<FriendShelf | null> {
  if (opts?.signal?.aborted) return null;
  const entries = await listUserShelfEntries(profile.did);
  if (entries.length === 0) return null;
  if (opts?.signal?.aborted) return null;
  const authors = await listUserAuthors(profile.did);
  return { profile, entries, authors };
}

/**
 * Enumerate every DID in the network whose repo holds at least one record in
 * the given collection, by paging through `com.atproto.sync.listReposByCollection`
 * on the relay. Returns null on any network/parse error so callers can fall
 * back to a full per-follow scan.
 *
 * The endpoint is optional for relays — bsky.network supports it; smaller
 * relays may not.
 */
async function listReposByCollection(
  collection: string,
  opts?: { signal?: AbortSignal },
): Promise<Set<string> | null> {
  const PAGE_SIZE = 1000;
  const dids = new Set<string>();
  let cursor: string | undefined;

  try {
    do {
      if (opts?.signal?.aborted) return null;
      const url = new URL(`${RELAY_HOST}/xrpc/com.atproto.sync.listReposByCollection`);
      url.searchParams.set("collection", collection);
      url.searchParams.set("limit", String(PAGE_SIZE));
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetch(url.toString(), { signal: opts?.signal });
      if (!res.ok) return null;
      const data = (await res.json()) as { repos?: { did?: string }[]; cursor?: string };
      for (const r of data.repos ?? []) {
        if (r.did) dids.add(r.did);
      }
      cursor = data.cursor;
    } while (cursor);
  } catch {
    return null;
  }

  return dids;
}

/**
 * Discover which of the user's Bluesky follows also use ShelfCheck.
 *
 * Strategy: ask the relay which repos in the entire network have an
 * org.shelfcheck.shelf.entry record, then intersect that with the user's
 * follows. This collapses what used to be a per-follow PDS sweep into one
 * network-wide enumeration plus a few targeted shelf fetches. If the relay
 * endpoint is unavailable we fall back to scanning every follow.
 *
 * Pass `excludeDids` to skip follows we've already discovered as friends —
 * those should be refreshed via {@link fetchFriendShelf} instead.
 */
export async function discoverFriends(
  session: OAuthSession,
  opts?: {
    signal?: AbortSignal;
    onProgress?: (checked: number, total: number) => void;
    excludeDids?: Iterable<string>;
  },
): Promise<FriendShelf[]> {
  // Run the relay enumeration in parallel with the follow list — they're
  // independent and both can be slow on large accounts.
  const [allFollows, shelfCheckDids] = await Promise.all([
    getFollows(session),
    listReposByCollection(NSID.shelfEntry, { signal: opts?.signal }),
  ]);

  if (opts?.signal?.aborted) return [];

  const exclude = new Set(opts?.excludeDids ?? []);
  let candidates = exclude.size > 0 ? allFollows.filter((f) => !exclude.has(f.did)) : allFollows;
  if (shelfCheckDids) {
    candidates = candidates.filter((f) => shelfCheckDids.has(f.did));
  }

  const friends: FriendShelf[] = [];

  const BATCH_SIZE = 5;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    if (opts?.signal?.aborted) break;

    const batch = candidates.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((follow) => fetchFriendShelf(follow, { signal: opts?.signal })),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        friends.push(result.value);
      }
    }

    opts?.onProgress?.(Math.min(i + BATCH_SIZE, candidates.length), candidates.length);
  }

  return friends;
}
