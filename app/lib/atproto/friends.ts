import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { NSID, type ShelfEntryRecord, type AuthorFollowRecord } from "./lexicon";

const PLCDIR = "https://plc.directory";

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

/** Cache of DID → PDS endpoint so we don't re-resolve within a single discovery run. */
const pdsCache = new Map<string, string | null>();

async function getPds(did: string): Promise<string | null> {
  if (pdsCache.has(did)) return pdsCache.get(did)!;
  const pds = await resolvePds(did);
  pdsCache.set(did, pds);
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
 * Discover which of the user's Bluesky follows also use ShelfCheck.
 * Checks each follow for org.shelfcheck.shelf.entry records.
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
  const allFollows = await getFollows(session);
  const exclude = new Set(opts?.excludeDids ?? []);
  const follows = exclude.size > 0 ? allFollows.filter((f) => !exclude.has(f.did)) : allFollows;
  const friends: FriendShelf[] = [];

  // Check follows in batches of 5 to avoid overwhelming the appview
  const BATCH_SIZE = 5;
  for (let i = 0; i < follows.length; i += BATCH_SIZE) {
    if (opts?.signal?.aborted) break;

    const batch = follows.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((follow) => fetchFriendShelf(follow, { signal: opts?.signal })),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        friends.push(result.value);
      }
    }

    opts?.onProgress?.(Math.min(i + BATCH_SIZE, follows.length), follows.length);
  }

  return friends;
}
