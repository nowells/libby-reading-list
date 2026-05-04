import { BrowserOAuthClient } from "@atproto/oauth-client-browser";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { Agent } from "@atproto/api";
import { bookhiveRecordsToBooks, type BookhiveListEntry } from "./bookhive-mapper";
import {
  pickBookLists,
  popfeedItemsToBooks,
  type PopfeedListEntry,
  type PopfeedListItemEntry,
} from "./popfeed-mapper";
import { enrichBooksWithWorkId } from "./openlibrary";
import { getBooks, setImportedBooks, type Book } from "./storage";
import { attachSession as attachSyncSession, detachSession, resync } from "./atproto/sync";
import { getTestOAuthHook, makeTestOAuthSession } from "./atproto/test-hook";

const PRODUCTION_CLIENT_ID = "https://www.shelfcheck.org/client-metadata.json";
const BOOKHIVE_COLLECTION = "buzz.bookhive.book";
const POPFEED_LIST_COLLECTION = "social.popfeed.feed.list";
const POPFEED_LIST_ITEM_COLLECTION = "social.popfeed.feed.listItem";
const HANDLE_RESOLVER = "https://bsky.social";
const PUBLIC_APPVIEW = "https://public.api.bsky.app";
/**
 * AT Proto OAuth scope. Granular `repo:<NSID>` scopes per the AT Proto OAuth
 * scopes spec — grants create/update/delete on each shelfcheck collection only.
 * Repo *reads* (listRecords, getRecord) are public XRPC and don't require any
 * scope, so the bookhive import and own-repo reads work without listing
 * `buzz.bookhive.book` here. AppView calls (getProfile, getFollows) are routed
 * through `public.api.bsky.app` unauthenticated, so we don't need `rpc:app.bsky.*`
 * scopes either.
 */
const OAUTH_SCOPE =
  "atproto repo:org.shelfcheck.shelf.entry repo:org.shelfcheck.author.follow repo:org.shelfcheck.book.dismissed";
/** How often to re-pull external sources (BookHive, Popfeed) and reconcile with the PDS. */
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;
/** Per-DID timestamp of the last successful PDS reconcile. */
const PDS_LAST_SYNC_PREFIX = "shelfcheck:pds-last-sync:";
/** The last account that successfully signed in, used to offer a one-click reauthenticate when the OAuth session is later lost. */
const LAST_BSKY_ACCOUNT_KEY = "shelfcheck:bsky-last-account";

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
    clientId = `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(OAUTH_SCOPE)}`;
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
/** Active 15-min auto-sync timer, cleared on sign-out / detach. */
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
/** Single-flight guard so overlapping invocations of syncEverything coalesce. */
let activeSyncPromise: Promise<void> | null = null;

/**
 * Initialize the OAuth client. If the current URL is an OAuth callback this
 * completes the flow and strips the params; otherwise it restores the last
 * active session (if any). Memoized because `client.init()` must run exactly
 * once per page load — React StrictMode's double-mount would otherwise race
 * the callback out of the URL before the second call could read it.
 *
 * On success, the session is attached to the ATproto sync engine which
 * mirrors org.shelfcheck.* record changes between local cache and the PDS,
 * external read-only sources (BookHive, Popfeed) are pulled into local cache
 * in the background, and a 15-minute auto-resync timer is armed.
 *
 * The returned promise resolves as soon as the PDS reconcile finishes —
 * external source pulls don't block UI rendering. Any books they add land
 * via storage mutations and surface via `onStorageMutation` subscribers.
 */
export function initSession(): Promise<InitResult | null> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const testHook = getTestOAuthHook();
    if (testHook) {
      const stored = testHook.getActiveSession();
      if (!stored) return null;
      const session = makeTestOAuthSession(stored);
      const fresh = testHook.consumeFresh();
      try {
        await attachSyncSession(session, { bootstrap: fresh });
        setLastPdsSync(session.did);
        scheduleAutoSync(session);
        kickOffExternalSync(session);
      } catch (err) {
        console.error("[atproto] failed to attach sync session", err);
      }
      setLastSignedInAccount({ did: stored.did, handle: stored.handle });
      return { session, info: { did: stored.did, handle: stored.handle }, fresh };
    }

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
      scheduleAutoSync(session);
      kickOffExternalSync(session);
    } catch (err) {
      console.error("[atproto] failed to attach sync session", err);
    }

    // Resolve the handle via the public AppView to avoid requiring an
    // `rpc:app.bsky.actor.getProfile` scope on the user's session.
    const handle = await fetchHandleForDid(session.did);
    setLastSignedInAccount({ did: session.did, handle });
    return { session, info: { did: session.did, handle }, fresh };
  })();
  return initPromise;
}

/**
 * Pull external sources (BookHive, Popfeed) without blocking the caller.
 * Errors are logged and swallowed — a transient PDS outage shouldn't keep
 * the rest of the app from starting up.
 */
function kickOffExternalSync(session: OAuthSession): void {
  void syncExternalSources(session).catch((err) =>
    console.error("[atproto] external source sync failed", err),
  );
}

/**
 * Look up the handle for a DID via the public AppView. Best-effort —
 * returns undefined on any failure; the DID alone is enough to continue.
 */
async function fetchHandleForDid(did: string): Promise<string | undefined> {
  try {
    const url = `${PUBLIC_APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`;
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const data: { handle?: string } = await res.json();
    return typeof data.handle === "string" ? data.handle : undefined;
  } catch {
    return undefined;
  }
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
  const testHook = getTestOAuthHook();
  if (testHook) {
    await testHook.signIn(handleOrPds);
    // Reload to mimic the OAuth redirect — the next initSession() picks up
    // the freshly installed test session and treats it as a fresh sign-in.
    initPromise = null;
    window.location.reload();
    // The reload will tear down execution; throw to satisfy the never return type.
    throw new Error("test-mode reload");
  }
  const client = await getClient();
  await client.signIn(handleOrPds, { scope: OAUTH_SCOPE });
  throw new Error("signIn should have redirected");
}

export async function signOut(did: string): Promise<void> {
  clearLastSignedInAccount();
  const testHook = getTestOAuthHook();
  if (testHook) {
    detachSyncSession();
    await testHook.signOut(did);
    initPromise = null;
    return;
  }
  const client = await getClient();
  detachSyncSession();
  await client.revoke(did);
  initPromise = null;
}

function detachSyncSession(): void {
  cancelAutoSync();
  detachSession();
}

function cancelAutoSync(): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}

function scheduleAutoSync(session: OAuthSession): void {
  cancelAutoSync();
  autoSyncTimer = setInterval(() => {
    void runFullSync(session, { silent: true });
  }, AUTO_SYNC_INTERVAL_MS);
}

/**
 * Run the org.shelfcheck.* PDS reconcile and pull every external read source
 * (BookHive, Popfeed). Errors are logged and swallowed when `silent` (the
 * timer-driven path) so a transient PDS outage doesn't crash the next tick.
 */
async function runFullSync(session: OAuthSession, opts: { silent?: boolean } = {}): Promise<void> {
  if (activeSyncPromise) return activeSyncPromise;
  activeSyncPromise = (async () => {
    try {
      await resync();
      await syncExternalSources(session);
      setLastPdsSync(session.did);
    } catch (err) {
      if (opts.silent) {
        console.error("[atproto] auto-sync failed", err);
      } else {
        throw err;
      }
    } finally {
      activeSyncPromise = null;
    }
  })();
  return activeSyncPromise;
}

/**
 * Manually re-run the full reconcile against the PDS plus a pull of every
 * external read source. Surfaces errors to the caller so the UI can render
 * a failure message; the auto-sync timer swallows them instead.
 */
export async function refreshPdsSync(did: string): Promise<void> {
  // We don't always have the OAuthSession at the call site (the books page
  // pill only has the did). Re-grab it from initSession(), which is memoized
  // for the lifetime of the page load.
  const init = await initSession();
  if (!init || init.info.did !== did) return;
  await runFullSync(init.session);
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

// --- Remembered account (for reauthenticate UI when the OAuth session is lost) ---

export interface RememberedBskyAccount {
  did: string;
  handle?: string;
}

/**
 * Returns the last account that successfully signed in, if any. Used by the
 * setup page to offer a one-click "Reauthenticate as @handle" affordance
 * after a refresh token expires (or any other case where `initSession()`
 * resolves without a live session). Cleared on explicit sign-out.
 */
export function getLastSignedInAccount(): RememberedBskyAccount | null {
  try {
    const raw = localStorage.getItem(LAST_BSKY_ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedBskyAccount>;
    if (typeof parsed?.did !== "string") return null;
    return {
      did: parsed.did,
      handle: typeof parsed.handle === "string" ? parsed.handle : undefined,
    };
  } catch {
    return null;
  }
}

function setLastSignedInAccount(info: RememberedBskyAccount): void {
  try {
    localStorage.setItem(LAST_BSKY_ACCOUNT_KEY, JSON.stringify(info));
  } catch {
    // Ignore quota errors
  }
}

export function clearLastSignedInAccount(): void {
  try {
    localStorage.removeItem(LAST_BSKY_ACCOUNT_KEY);
  } catch {
    // Ignore
  }
}

// --- External read sources (BookHive + Popfeed) ---

/**
 * Pull every external read source we support and merge each one into local
 * state under its own source bucket. Sources are independent — if one fails
 * the others still run. Books that already exist locally keep any
 * Open-Library enrichment from a prior pass so we don't repeatedly hit the
 * OL search API for the same titles.
 */
async function syncExternalSources(session: OAuthSession): Promise<void> {
  await Promise.all([safeSyncBookHive(session), safeSyncPopfeed(session)]);
}

async function safeSyncBookHive(session: OAuthSession): Promise<void> {
  try {
    await syncFromBookHive(session);
  } catch (err) {
    console.error("[atproto] bookhive sync failed", err);
  }
}

async function safeSyncPopfeed(session: OAuthSession): Promise<void> {
  try {
    await syncFromPopfeed(session);
  } catch (err) {
    console.error("[atproto] popfeed sync failed", err);
  }
}

/**
 * Read the user's `buzz.bookhive.book` records, map them into Books and
 * replace the bookhive-source slice of local storage. The active sync engine
 * mirrors any changes into `org.shelfcheck.shelf.entry` records.
 */
async function syncFromBookHive(session: OAuthSession): Promise<Book[]> {
  const fresh = await fetchBookhiveBooks(session);
  const merged = mergeWithPriorEnrichment(fresh, "bookhive");
  const enriched = await enrichBooksWithWorkId(merged);
  setImportedBooks(enriched, "bookhive");
  return enriched;
}

/**
 * Read the user's `social.popfeed.feed.list*` records, map any book-related
 * lists into Books and replace the popfeed-source slice of local storage.
 */
async function syncFromPopfeed(session: OAuthSession): Promise<Book[]> {
  const fresh = await fetchPopfeedBooks(session);
  const merged = mergeWithPriorEnrichment(fresh, "popfeed");
  const enriched = await enrichBooksWithWorkId(merged);
  setImportedBooks(enriched, "popfeed");
  return enriched;
}

/**
 * Carry forward Open-Library enrichment (workId, canonical names, subjects,
 * page count, publish year, cover) from prior books in the same source so a
 * 15-minute resync does not re-issue OL lookups for unchanged entries. Books
 * are matched by their stable id (`bh-<rkey>` / `pf-<rkey>`).
 */
function mergeWithPriorEnrichment(fresh: Book[], source: Book["source"]): Book[] {
  const prior = new Map(
    getBooks()
      .filter((b) => b.source === source)
      .map((b) => [b.id, b]),
  );
  if (prior.size === 0) return fresh;
  return fresh.map((b) => {
    const prev = prior.get(b.id);
    if (!prev) return b;
    return {
      ...b,
      workId: b.workId ?? prev.workId,
      isbn13: b.isbn13 ?? prev.isbn13,
      imageUrl: b.imageUrl ?? prev.imageUrl,
      canonicalTitle: b.canonicalTitle ?? prev.canonicalTitle,
      canonicalAuthor: b.canonicalAuthor ?? prev.canonicalAuthor,
      subjects: b.subjects ?? prev.subjects,
      pageCount: b.pageCount ?? prev.pageCount,
      firstPublishYear: b.firstPublishYear ?? prev.firstPublishYear,
      pdsRkey: b.pdsRkey ?? prev.pdsRkey,
    };
  });
}

/**
 * Fetch all `buzz.bookhive.book` records for the authenticated user and
 * map them into shelfcheck's `Book` shape with their reading status.
 */
async function fetchBookhiveBooks(session: OAuthSession): Promise<Book[]> {
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

async function fetchPopfeedBooks(session: OAuthSession): Promise<Book[]> {
  const agent = new Agent(session);

  const lists: PopfeedListEntry[] = [];
  let cursor: string | undefined;
  do {
    let res;
    try {
      res = await agent.com.atproto.repo.listRecords({
        repo: session.did,
        collection: POPFEED_LIST_COLLECTION,
        limit: 100,
        cursor,
      });
    } catch {
      // Most users won't have any popfeed records — treat the missing
      // collection as an empty result rather than failing the whole sync.
      return [];
    }
    for (const r of res.data.records) {
      lists.push({
        uri: r.uri,
        cid: r.cid,
        value: r.value as unknown as PopfeedListEntry["value"],
      });
    }
    cursor = res.data.cursor;
  } while (cursor);

  const bookLists = pickBookLists(lists);
  if (bookLists.length === 0) return [];
  const listStatusMap = new Map(
    bookLists.map(({ entry, defaultStatus }) => [entry.uri, defaultStatus]),
  );

  const items: PopfeedListItemEntry[] = [];
  cursor = undefined;
  do {
    let res;
    try {
      res = await agent.com.atproto.repo.listRecords({
        repo: session.did,
        collection: POPFEED_LIST_ITEM_COLLECTION,
        limit: 100,
        cursor,
      });
    } catch {
      return [];
    }
    for (const r of res.data.records) {
      items.push({
        uri: r.uri,
        cid: r.cid,
        value: r.value as unknown as PopfeedListItemEntry["value"],
      });
    }
    cursor = res.data.cursor;
  } while (cursor);

  return popfeedItemsToBooks(items, listStatusMap);
}
