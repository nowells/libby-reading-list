import { BrowserOAuthClient } from "@atproto/oauth-client-browser";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { Agent } from "@atproto/api";
import { bookhiveRecordsToBooks, type BookhiveListEntry } from "./bookhive-mapper";
import { enrichBooksWithWorkId } from "./openlibrary";
import { setImportedBooks, type Book } from "./storage";
import { attachSession as attachSyncSession, detachSession, resync } from "./atproto/sync";

const PRODUCTION_CLIENT_ID = "https://www.shelfcheck.org/client-metadata.json";
const BOOKHIVE_COLLECTION = "buzz.bookhive.book";
const HANDLE_RESOLVER = "https://bsky.social";
const PUBLIC_APPVIEW = "https://public.api.bsky.app";
/** Per-DID flag tracking whether we've already pulled the user's BookHive shelf into ShelfCheck. */
const BOOKHIVE_IMPORTED_PREFIX = "shelfcheck:bookhive-imported:";
/** Per-DID timestamp of the last successful PDS reconcile. */
const PDS_LAST_SYNC_PREFIX = "shelfcheck:pds-last-sync:";

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
 *
 * On success, the session is attached to the ATproto sync engine which
 * mirrors org.shelfcheck.* record changes between local cache and the PDS.
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

    // Hydrate / reconcile the user's PDS records before any UI consumes
    // local state. `bootstrap: true` on a fresh sign-in lets local data
    // migrate up to an empty PDS (the typical first-sign-in case).
    try {
      await attachSyncSession(session, { bootstrap: fresh });
      setLastPdsSync(session.did);
    } catch (err) {
      console.error("[atproto] failed to attach sync session", err);
    }

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
  detachSyncSession();
  await client.revoke(did);
  initPromise = null;
}

function detachSyncSession(): void {
  detachSession();
}

/**
 * Manually re-run a full reconcile against the PDS. Useful as a "Refresh"
 * button — after attach this is the same diff/merge that runs during
 * boot. Does NOT alter bookhive-imported state.
 */
export async function refreshPdsSync(did: string): Promise<void> {
  await resync();
  setLastPdsSync(did);
}

export function getLastPdsSync(did: string): string | null {
  try {
    return localStorage.getItem(PDS_LAST_SYNC_PREFIX + did);
  } catch {
    return null;
  }
}

function setLastPdsSync(did: string): void {
  try {
    localStorage.setItem(PDS_LAST_SYNC_PREFIX + did, new Date().toISOString());
  } catch {
    // Ignore quota errors
  }
}

// --- BookHive one-time import ---

export function hasImportedFromBookHive(did: string): boolean {
  try {
    return localStorage.getItem(BOOKHIVE_IMPORTED_PREFIX + did) !== null;
  } catch {
    return false;
  }
}

function markImportedFromBookHive(did: string): void {
  try {
    localStorage.setItem(BOOKHIVE_IMPORTED_PREFIX + did, new Date().toISOString());
  } catch {
    // Ignore quota errors
  }
}

/**
 * One-time migration helper: reads the user's existing buzz.bookhive.book
 * "want to read" records and writes them as ShelfCheck books. The active
 * sync engine then mirrors those into org.shelfcheck.shelf.entry records on
 * the same PDS, so subsequent app activity uses ShelfCheck's lexicon
 * exclusively. We do not delete the original BookHive records — those
 * remain readable by BookHive itself.
 */
export async function importFromBookHive(
  session: OAuthSession,
  opts: { clearManual?: boolean } = {},
): Promise<Book[]> {
  const books = await fetchBookhiveWantToRead(session);
  const enriched = await enrichBooksWithWorkId(books);
  markImportedFromBookHive(session.did);
  if (enriched.length > 0) {
    setImportedBooks(enriched, "bookhive", { clearManual: opts.clearManual });
  }
  return enriched;
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
