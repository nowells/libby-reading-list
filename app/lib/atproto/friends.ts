import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { NSID, type ShelfEntryRecord, type AuthorFollowRecord } from "./lexicon";

const PUBLIC_APPVIEW = "https://public.api.bsky.app";

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
 * Check if a user has any org.shelfcheck.shelf.entry records (i.e. uses ShelfCheck).
 * Uses the public appview so no auth is needed to read public PDS records.
 */
async function listUserShelfEntries(
  did: string,
  opts?: { limit?: number },
): Promise<ShelfEntryRecord[]> {
  const limit = opts?.limit ?? 100;
  const entries: ShelfEntryRecord[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${PUBLIC_APPVIEW}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set("repo", did);
    url.searchParams.set("collection", NSID.shelfEntry);
    url.searchParams.set("limit", String(Math.min(limit - entries.length, 100)));
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString());
    if (!res.ok) break;
    const data = await res.json();
    for (const r of data.records ?? []) {
      entries.push(r.value as ShelfEntryRecord);
    }
    cursor = data.cursor;
  } while (cursor && entries.length < limit);

  return entries;
}

/**
 * List a user's followed authors from their PDS.
 */
async function listUserAuthors(did: string): Promise<AuthorFollowRecord[]> {
  const authors: AuthorFollowRecord[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${PUBLIC_APPVIEW}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set("repo", did);
    url.searchParams.set("collection", NSID.authorFollow);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString());
    if (!res.ok) break;
    const data = await res.json();
    for (const r of data.records ?? []) {
      authors.push(r.value as AuthorFollowRecord);
    }
    cursor = data.cursor;
  } while (cursor);

  return authors;
}

/**
 * Discover which of the user's Bluesky follows also use ShelfCheck.
 * Checks each follow for org.shelfcheck.shelf.entry records.
 */
export async function discoverFriends(
  session: OAuthSession,
  opts?: { signal?: AbortSignal; onProgress?: (checked: number, total: number) => void },
): Promise<FriendShelf[]> {
  const follows = await getFollows(session);
  const friends: FriendShelf[] = [];

  // Check follows in batches of 5 to avoid overwhelming the appview
  const BATCH_SIZE = 5;
  for (let i = 0; i < follows.length; i += BATCH_SIZE) {
    if (opts?.signal?.aborted) break;

    const batch = follows.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (follow) => {
        const entries = await listUserShelfEntries(follow.did, { limit: 100 });
        if (entries.length > 0) {
          const authors = await listUserAuthors(follow.did);
          return { profile: follow, entries, authors };
        }
        return null;
      }),
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
