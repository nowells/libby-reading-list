import type { OAuthSession } from "@atproto/oauth-client-browser";
import { NSID, type ShelfEntryRecord, type AuthorFollowRecord } from "./lexicon";

const PLCDIR = "https://plc.directory";
const BSKY_FOLLOW_COLLECTION = "app.bsky.graph.follow";
const BSKY_PROFILE_COLLECTION = "app.bsky.actor.profile";

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

interface Actor {
  pds: string;
  handle: string;
}

/**
 * Get the authenticated user's follows by reading `app.bsky.graph.follow`
 * records directly from their own PDS.
 *
 * Avoids hitting any AppView (Bluesky's or otherwise) — follow records live
 * in the user's repo and `com.atproto.repo.listRecords` is a public XRPC
 * method, so this works for any AT Protocol user regardless of which
 * AppView (if any) indexes their data.
 */
async function getFollows(session: OAuthSession): Promise<string[]> {
  const actor = await getActor(session.did);
  if (!actor) return [];

  const dids: string[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${actor.pds}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set("repo", session.did);
    url.searchParams.set("collection", BSKY_FOLLOW_COLLECTION);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString());
    if (!res.ok) break;
    const data: {
      records?: { value?: { subject?: unknown } }[];
      cursor?: string;
    } = await res.json();
    for (const r of data.records ?? []) {
      const subject = r.value?.subject;
      if (typeof subject === "string") dids.push(subject);
    }
    cursor = data.cursor;
  } while (cursor);

  return dids;
}

/**
 * Resolve a DID to its PDS service endpoint and primary handle.
 * Handles both did:plc (via plc.directory) and did:web (via .well-known).
 *
 * The handle comes from `alsoKnownAs[0]` (an `at://<handle>` URI). If a DID
 * has no `alsoKnownAs` entry we fall back to the DID itself for display —
 * unusual but valid.
 */
async function resolveActor(did: string): Promise<Actor | null> {
  try {
    const docUrl = did.startsWith("did:web:")
      ? `https://${did.slice("did:web:".length)}/.well-known/did.json`
      : `${PLCDIR}/${did}`;
    const res = await fetch(docUrl);
    if (!res.ok) return null;
    const doc = (await res.json()) as {
      service?: { id: string; type: string; serviceEndpoint: string }[];
      alsoKnownAs?: string[];
    };
    const pdsService = doc.service?.find(
      (s) => s.id === "#atproto_pds" && s.type === "AtprotoPersonalDataServer",
    );
    if (!pdsService?.serviceEndpoint) return null;
    const handleUri = doc.alsoKnownAs?.find((u) => u.startsWith("at://"));
    const handle = handleUri ? handleUri.slice("at://".length) : did;
    return { pds: pdsService.serviceEndpoint, handle };
  } catch {
    return null;
  }
}

/**
 * Persistent cache of DID → { PDS endpoint, handle }. PDS migrations and
 * handle changes are rare, so we keep resolutions for 30 days; the in-memory
 * map below dedups within a single run.
 *
 * Exported for tests.
 */
export const PDS_CACHE_KEY = "shelfcheck:pds-cache";
export const PDS_CACHE_VERSION = 2;
const PDS_CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30 days

interface PdsCacheEntry {
  pds: string;
  handle: string;
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

function getCachedActor(did: string): Actor | null {
  const cache = readPdsCache();
  const entry = cache.entries[did];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > PDS_CACHE_MAX_AGE) return null;
  return { pds: entry.pds, handle: entry.handle };
}

function setCachedActor(did: string, actor: Actor): void {
  try {
    const cache = readPdsCache();
    cache.entries[did] = { pds: actor.pds, handle: actor.handle, fetchedAt: Date.now() };
    localStorage.setItem(PDS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota / unavailable storage
  }
}

/** In-memory dedup so a single discovery run never resolves the same DID twice. */
const actorRunCache = new Map<string, Actor | null>();

/** Test-only: drop the in-memory dedup map so tests start with a clean slate. */
export function _resetPdsRunCacheForTests(): void {
  actorRunCache.clear();
}

async function getActor(did: string): Promise<Actor | null> {
  if (actorRunCache.has(did)) return actorRunCache.get(did)!;

  const cached = getCachedActor(did);
  if (cached) {
    actorRunCache.set(did, cached);
    return cached;
  }

  const actor = await resolveActor(did);
  actorRunCache.set(did, actor);
  // Only persist successful resolutions — null means resolution failed and
  // we should retry on the next page load.
  if (actor) setCachedActor(did, actor);
  return actor;
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
  const actor = await getActor(did);
  if (!actor) return [];

  const limit = opts?.limit ?? Infinity;
  const out: T[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${actor.pds}/xrpc/com.atproto.repo.listRecords`);
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
 * Fetch a user's `app.bsky.actor.profile/self` record from their PDS to
 * pull out displayName and a public avatar URL.
 *
 * Returns null on transport / parse failure — caller preserves whatever
 * cached values the friend already has. Returns {} when the user has no
 * profile record (or it has neither field) — caller treats those as
 * cleared.
 */
async function fetchActorProfile(
  did: string,
  actor: Actor,
): Promise<{ displayName?: string; avatar?: string } | null> {
  try {
    const url = new URL(`${actor.pds}/xrpc/com.atproto.repo.getRecord`);
    url.searchParams.set("repo", did);
    url.searchParams.set("collection", BSKY_PROFILE_COLLECTION);
    url.searchParams.set("rkey", "self");
    const res = await fetch(url.toString());
    // getRecord returns 400 with `error: "RecordNotFound"` when the rkey
    // doesn't exist; 404 from some implementations. Treat both as "user
    // has no profile" rather than a transport failure.
    if (res.status === 400 || res.status === 404) return {};
    if (!res.ok) return null;
    const data = (await res.json()) as {
      value?: { displayName?: string; avatar?: { ref?: { $link?: string } } };
    };
    const record = data.value;
    if (!record) return {};
    const cid = record.avatar?.ref?.$link;
    return {
      displayName: record.displayName,
      avatar: cid
        ? `${actor.pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`
        : undefined,
    };
  } catch {
    return null;
  }
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

  // The actor was already resolved by listUserShelfEntries → the in-memory
  // cache makes this free. Use it to fetch the profile in parallel with
  // the author list so enrichment doesn't add a serial round-trip.
  const actor = await getActor(profile.did);
  const [authors, enrichment] = await Promise.all([
    listUserAuthors(profile.did),
    actor ? fetchActorProfile(profile.did, actor) : Promise.resolve(null),
  ]);

  return {
    profile: enrichment ? { did: profile.did, handle: profile.handle, ...enrichment } : profile,
    entries,
    authors,
  };
}

/**
 * Discover which of the user's Bluesky follows also use ShelfCheck.
 * Reads `app.bsky.graph.follow` records from the user's own PDS, then for
 * each followed DID resolves the actor (PDS + handle) and checks for
 * `org.shelfcheck.shelf.entry` records on their PDS.
 *
 * Pass `excludeDids` to skip follows we've already discovered as friends —
 * those should be refreshed via {@link fetchFriendShelf} instead.
 *
 * Note: the returned `FriendProfile` only carries `did` + `handle`. Display
 * name and avatar are not populated by discovery — callers that need them
 * should preserve cached values across refreshes.
 */
export async function discoverFriends(
  session: OAuthSession,
  opts?: {
    signal?: AbortSignal;
    onProgress?: (checked: number, total: number) => void;
    excludeDids?: Iterable<string>;
  },
): Promise<FriendShelf[]> {
  const allFollowDids = await getFollows(session);
  const exclude = new Set(opts?.excludeDids ?? []);
  const followDids =
    exclude.size > 0 ? allFollowDids.filter((d) => !exclude.has(d)) : allFollowDids;
  const friends: FriendShelf[] = [];

  // Check follows in batches of 5 to avoid hammering plc.directory and PDSes.
  const BATCH_SIZE = 5;
  for (let i = 0; i < followDids.length; i += BATCH_SIZE) {
    if (opts?.signal?.aborted) break;

    const batch = followDids.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (did) => {
        const actor = await getActor(did);
        if (!actor) return null;
        return fetchFriendShelf({ did, handle: actor.handle }, { signal: opts?.signal });
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        friends.push(result.value);
      }
    }

    opts?.onProgress?.(Math.min(i + BATCH_SIZE, followDids.length), followDids.length);
  }

  return friends;
}
