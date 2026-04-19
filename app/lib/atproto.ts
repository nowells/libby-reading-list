import { BrowserOAuthClient } from "@atproto/oauth-client-browser";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { Agent } from "@atproto/api";
import { bookhiveRecordsToBooks, type BookhiveListEntry } from "./bookhive-mapper";
import { getBookhiveLastSync, setBookhiveLastSync, setImportedBooks, type Book } from "./storage";

const PRODUCTION_CLIENT_ID = "https://libby.strite.org/client-metadata.json";
const BOOKHIVE_COLLECTION = "buzz.bookhive.book";
const HANDLE_RESOLVER = "https://bsky.social";
const PUBLIC_APPVIEW = "https://public.api.bsky.app";
const SYNC_TTL_MS = 24 * 60 * 60 * 1000;

function isLoopback(): boolean {
  const { hostname } = window.location;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

let clientPromise: Promise<BrowserOAuthClient> | null = null;

/**
 * Lazily construct (and memoize) the OAuth client. Uses the hosted
 * client-metadata.json in production. In development, passes an `http:`
 * loopback `clientId` — `BrowserOAuthClient.load` recognizes this and
 * synthesizes the metadata that atproto OAuth servers accept for loopback
 * clients (no hosted metadata needed).
 */
function getClient(): Promise<BrowserOAuthClient> {
  if (clientPromise) return clientPromise;

  let clientId: string;
  if (isLoopback()) {
    const redirectUri = `${window.location.origin}/setup`;
    clientId = `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent("atproto transition:generic")}`;
  } else {
    clientId = PRODUCTION_CLIENT_ID;
  }

  clientPromise = BrowserOAuthClient.load({
    clientId,
    handleResolver: HANDLE_RESOLVER,
  });
  return clientPromise;
}

export interface AtprotoSessionInfo {
  did: string;
  handle?: string;
}

interface InitResult {
  session: OAuthSession;
  info: AtprotoSessionInfo;
  /** True when this init processed an OAuth callback (fresh sign-in), false when restoring a stored session. */
  fresh: boolean;
}

let initPromise: Promise<InitResult | null> | null = null;

/**
 * Initialize the OAuth client. If the current URL is an OAuth callback this
 * completes the flow and strips the params; otherwise it restores the last
 * active session (if any). Memoized because `client.init()` must run exactly
 * once per page load — React StrictMode's double-mount would otherwise race
 * the callback out of the URL before the second call could read it.
 */
export function initSession(): Promise<InitResult | null> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const client = await getClient();
    const result = await client.init();
    if (!result) return null;

    const session = result.session;
    // `state` is present only when init processed an OAuth callback.
    const fresh = (result as { state?: string | null }).state !== undefined;
    const agent = new Agent(session);
    let handle: string | undefined;
    try {
      const profile = await agent.getProfile({ actor: session.did });
      handle = profile.data.handle;
    } catch {
      // Profile lookup is best-effort; the DID alone is enough to continue.
    }
    return { session, info: { did: session.did, handle }, fresh };
  })();
  return initPromise;
}

export interface HandleSuggestion {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/**
 * Query the Bluesky public appview for handle suggestions matching `query`.
 * Mirrors the typeahead behavior on bsky.app's login / search fields. Unauthed.
 */
export async function searchHandleSuggestions(
  query: string,
  signal?: AbortSignal,
): Promise<HandleSuggestion[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const url = `${PUBLIC_APPVIEW}/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(q)}&limit=8`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data: { actors?: HandleSuggestion[] } = await res.json();
  return data.actors ?? [];
}

export async function signInWithBluesky(handleOrPds: string): Promise<never> {
  const client = await getClient();
  await client.signIn(handleOrPds, { scope: "atproto transition:generic" });
  throw new Error("signIn should have redirected");
}

export async function signOut(did: string): Promise<void> {
  const client = await getClient();
  await client.revoke(did);
  initPromise = null;
}

/** True when last sync is missing or older than SYNC_TTL_MS. */
export function isBookhiveSyncStale(): boolean {
  const last = getBookhiveLastSync();
  if (!last) return true;
  const lastMs = new Date(last).getTime();
  if (Number.isNaN(lastMs)) return true;
  return Date.now() - lastMs > SYNC_TTL_MS;
}

/**
 * Full Bookhive sync: fetch records, persist the imported list (preserving
 * manual books unless `clearManual`), and update the last-sync timestamp.
 * Always bumps the timestamp on a successful network call — empty repos
 * should not trigger a retry loop on every page load.
 */
export async function syncBookhive(
  session: OAuthSession,
  opts: { clearManual?: boolean } = {},
): Promise<Book[]> {
  const books = await fetchBookhiveWantToRead(session);
  setBookhiveLastSync(new Date().toISOString());
  if (books.length > 0) {
    setImportedBooks(books, opts.clearManual ?? false);
  }
  return books;
}

/**
 * Fetch all `buzz.bookhive.book` records for the authenticated user and
 * return the ones marked `wantToRead`, mapped into shelfcheck's `Book` shape.
 */
async function fetchBookhiveWantToRead(session: OAuthSession): Promise<Book[]> {
  const agent = new Agent(session);
  const entries: BookhiveListEntry[] = [];
  let cursor: string | undefined;

  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: session.did,
      collection: BOOKHIVE_COLLECTION,
      limit: 100,
      cursor,
    });
    for (const r of res.data.records) {
      entries.push({
        uri: r.uri,
        cid: r.cid,
        value: r.value as unknown as BookhiveListEntry["value"],
      });
    }
    cursor = res.data.cursor;
  } while (cursor);

  return bookhiveRecordsToBooks(entries);
}
