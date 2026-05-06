import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
  _mergeBookFromPds,
  _replaceAuthorsFromPds,
  _replaceBooksFromPds,
  _replaceDismissedFromPds,
  _setAuthorPdsRkey,
  _setBookPdsRkey,
  _setDismissedPdsRkey,
  _setReadPdsRkey,
  getAuthors,
  getBooks,
  getDismissedWorks,
  getReadBooks,
  onStorageMutation,
  type AuthorEntry,
  type Book,
  type DismissedWorkEntry,
  type ReadBookEntry,
  type StorageMutation,
} from "../storage";
import { bookKey } from "../dedupe";
import {
  authorEntryToRecord,
  authorRecordToEntry,
  bookToShelfRecord,
  dismissedRecordToEntry,
  dismissedToRecord,
  readEntryToShelfRecord,
  shelfRecordToBook,
  statusFromToken,
} from "./mappers";
import {
  NSID,
  STATUS,
  type AuthorFollowRecord,
  type BookDismissedRecord,
  type ShelfEntryRecord,
  type ShelfStatusToken,
} from "./lexicon";
import { deleteRecord, listRecords, putRecord, type ListedRecord } from "./records";

let activeSession: OAuthSession | null = null;
let unsubscribe: (() => void) | null = null;

interface AttachOptions {
  /**
   * If true, treat this attach as the user's first sync on this device.
   * When local data exists and the PDS is empty, the local data is pushed
   * up. When the PDS has any records, those are pulled down (replacing
   * local). When `false`, runs the normal merge reconcile (push local-only
   * up, pull PDS-only down, no deletions).
   */
  bootstrap?: boolean;
}

/**
 * Attach an authenticated session and reconcile local cache <-> PDS state.
 * Subsequent local mutations are mirrored to the PDS automatically while the
 * session is attached.
 */
export async function attachSession(
  session: OAuthSession,
  opts: AttachOptions = {},
): Promise<void> {
  detachSession();
  activeSession = session;
  await reconcile(session, opts);
  unsubscribe = onStorageMutation((m) => handleMutation(session, m));
}

export function detachSession(): void {
  activeSession = null;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

/**
 * Pull all PDS records and merge with local state. Local-only entities are
 * pushed up to the PDS; PDS-only records are pulled down into local. By
 * default, no deletions happen during reconcile — explicit deletions
 * propagate via the mutation listener.
 */
async function reconcile(session: OAuthSession, opts: AttachOptions): Promise<void> {
  const [shelfRecords, authorRecords, dismissedRecords] = await Promise.all([
    listRecords<ShelfEntryRecord>(session, NSID.shelfEntry),
    listRecords<AuthorFollowRecord>(session, NSID.authorFollow),
    listRecords<BookDismissedRecord>(session, NSID.bookDismissed),
  ]);

  await reconcileShelfEntries(session, shelfRecords, opts);
  await reconcileAuthors(session, authorRecords, opts);
  await reconcileDismissed(session, dismissedRecords, opts);
}

// --- Shelf entries (books + reads) ---

interface IndexedShelfRecord {
  rkey: string;
  status: ShelfStatusToken;
  contentKey: string;
  value: ShelfEntryRecord;
}

function indexShelfRecords(records: ListedRecord<ShelfEntryRecord>[]): IndexedShelfRecord[] {
  const out: IndexedShelfRecord[] = [];
  for (const r of records) {
    const status = statusFromToken(r.value.status);
    if (!status) continue;
    const ids = r.value.ids ?? {};
    const author = r.value.authors?.[0]?.name ?? "";
    const contentKey = ids.olWorkId
      ? `work:${ids.olWorkId}`
      : `fuzzy:${normalize(r.value.title)}\0${normalize(author)}`;
    out.push({ rkey: r.rkey, status, contentKey, value: r.value });
  }
  return out;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Group records by `contentKey` and pick a canonical winner per group, so
 * the rest of reconcile sees one record per work. Losers are returned in
 * `duplicates` so the caller can clean them up from the PDS.
 *
 * Winner selection prioritizes records that carry the most user-facing
 * data — rating, note, started/finished timestamps, rich metadata —
 * because losing those edits is more harmful than losing the rkey itself.
 */
function dedupeIndexedShelfRecords(indexed: IndexedShelfRecord[]): {
  unique: IndexedShelfRecord[];
  duplicates: IndexedShelfRecord[];
} {
  const groups = new Map<string, IndexedShelfRecord[]>();
  for (const rec of indexed) {
    const arr = groups.get(rec.contentKey);
    if (arr) arr.push(rec);
    else groups.set(rec.contentKey, [rec]);
  }
  const unique: IndexedShelfRecord[] = [];
  const duplicates: IndexedShelfRecord[] = [];
  for (const arr of groups.values()) {
    if (arr.length === 1) {
      unique.push(arr[0]);
      continue;
    }
    const sorted = [...arr].sort((a, b) => scoreShelfRecord(b) - scoreShelfRecord(a));
    unique.push(sorted[0]);
    for (let i = 1; i < sorted.length; i++) duplicates.push(sorted[i]);
  }
  return { unique, duplicates };
}

function scoreShelfRecord(r: IndexedShelfRecord): number {
  const v = r.value;
  let score = 0;
  // User-authored data — preserve at all costs.
  if (typeof v.rating === "number") score += 1000;
  if (v.note) score += 1000;
  if (v.startedAt) score += 200;
  if (v.finishedAt) score += 200;
  // A non-default status is more informative than the implicit wantToRead.
  if (r.status !== STATUS.wantToRead) score += 100;
  // Metadata richness.
  if (v.ids.olWorkId) score += 50;
  if (v.coverUrl) score += 10;
  if (v.subjects && v.subjects.length > 0) score += 10;
  if (typeof v.pageCount === "number") score += 5;
  if (typeof v.firstPublishYear === "number") score += 5;
  if (v.sourceUrl) score += 3;
  // Recency tiebreaker: more-recent updates win when otherwise equal.
  const ts = Date.parse(v.updatedAt ?? v.createdAt);
  if (Number.isFinite(ts)) score += ts / 1e12;
  return score;
}

async function deleteDuplicateShelfRecords(
  session: OAuthSession,
  duplicates: IndexedShelfRecord[],
): Promise<void> {
  await deleteDuplicateRecords(
    session,
    NSID.shelfEntry,
    duplicates.map((d) => ({ rkey: d.rkey })),
    "shelf entry",
  );
}

/**
 * Generic dedupe helper for "list every record, keep one per natural key,
 * delete the rest." Authors are keyed by olAuthorKey-or-name; dismissed
 * works by olWorkId-or-fuzzy-key.
 */
function dedupeByKey<T>(
  records: ListedRecord<T>[],
  keyOf: (r: ListedRecord<T>) => string,
  scoreOf: (r: ListedRecord<T>) => number,
): { unique: ListedRecord<T>[]; duplicates: ListedRecord<T>[] } {
  const groups = new Map<string, ListedRecord<T>[]>();
  for (const r of records) {
    const k = keyOf(r);
    const arr = groups.get(k);
    if (arr) arr.push(r);
    else groups.set(k, [r]);
  }
  const unique: ListedRecord<T>[] = [];
  const duplicates: ListedRecord<T>[] = [];
  for (const arr of groups.values()) {
    if (arr.length === 1) {
      unique.push(arr[0]);
      continue;
    }
    const sorted = [...arr].sort((a, b) => scoreOf(b) - scoreOf(a));
    unique.push(sorted[0]);
    for (let i = 1; i < sorted.length; i++) duplicates.push(sorted[i]);
  }
  return { unique, duplicates };
}

function dedupeAuthorRecords(records: ListedRecord<AuthorFollowRecord>[]): {
  unique: ListedRecord<AuthorFollowRecord>[];
  duplicates: ListedRecord<AuthorFollowRecord>[];
} {
  return dedupeByKey(
    records,
    (r) => r.value.olAuthorKey ?? r.value.name.toLowerCase(),
    (r) => {
      let s = 0;
      if (r.value.olAuthorKey) s += 50;
      if (r.value.imageUrl) s += 10;
      const ts = Date.parse(r.value.createdAt);
      if (Number.isFinite(ts)) s += ts / 1e12;
      return s;
    },
  );
}

function dedupeDismissedRecords(records: ListedRecord<BookDismissedRecord>[]): {
  unique: ListedRecord<BookDismissedRecord>[];
  duplicates: ListedRecord<BookDismissedRecord>[];
} {
  return dedupeByKey(
    records,
    (r) => contentKeyForDismissed(r.value),
    (r) => {
      let s = 0;
      if (r.value.ids?.olWorkId) s += 50;
      if (r.value.title) s += 5;
      if (r.value.authors?.length) s += 5;
      const ts = Date.parse(r.value.createdAt);
      if (Number.isFinite(ts)) s += ts / 1e12;
      return s;
    },
  );
}

async function deleteDuplicateRecords(
  session: OAuthSession,
  collection: (typeof NSID)[keyof typeof NSID],
  duplicates: { rkey: string }[],
  label: string,
): Promise<void> {
  if (duplicates.length === 0) return;
  console.warn(
    `[sync] removing ${duplicates.length} duplicate ${label}${duplicates.length === 1 ? "" : "s"} from PDS`,
  );
  // Sequential to keep the PDS write rate sane. Errors are logged and
  // skipped — the next reconcile will retry any remaining duplicate.
  for (const dup of duplicates) {
    try {
      await deleteRecord(session, collection, dup.rkey);
    } catch (err) {
      console.error(`[sync] failed to delete duplicate ${label}`, err);
    }
  }
}

async function reconcileShelfEntries(
  session: OAuthSession,
  records: ListedRecord<ShelfEntryRecord>[],
  opts: AttachOptions,
): Promise<void> {
  const indexedAll = indexShelfRecords(records);
  // Collapse duplicate PDS records for the same work. A handful of code
  // paths (mark-as-read fanout, reconcileBulkBooks key-drift, two-device
  // first-syncs with diverging fuzzy keys) have been observed to leave
  // multiple shelf entries pointing at the same book — auto-heal here so
  // every reconcile leaves the PDS in canonical shape.
  const { unique: indexed, duplicates } = dedupeIndexedShelfRecords(indexedAll);
  await deleteDuplicateShelfRecords(session, duplicates);

  const localBooks = getBooks();
  const localReads = getReadBooks();

  // Bootstrap mode: PDS empty + local has data -> push local up.
  if (opts.bootstrap && indexed.length === 0 && (localBooks.length || localReads.length)) {
    await pushAllLocalShelf(session, localBooks, localReads);
    return;
  }

  // Pull-down: PDS records that local doesn't have.
  const localBooksByKey = new Map(localBooks.map((b) => [bookKey(b), b]));
  const localReadKeys = new Set(localReads.map((r) => r.key));

  const newBooks: Book[] = [];

  for (const rec of indexed) {
    // If a Book in our local cache matches this PDS record (by content
    // key), the PDS record represents the same shelf entry regardless of
    // status. Just sync the rkey so subsequent edits target this record;
    // don't fan out to ReadBookEntry. This keeps local state in exactly
    // one place when the user changes a book's status.
    const localBook = localBooksByKey.get(rec.contentKey);
    if (localBook) {
      mergeRkeyAndMetadata(localBook, rec.rkey, rec.value);
      continue;
    }

    // Legacy: a ReadBookEntry already represents this work. Keep using
    // that cache slot rather than creating a parallel Book.
    if (
      (rec.status === STATUS.finished || rec.status === STATUS.abandoned) &&
      localReadKeys.has(rec.contentKey)
    ) {
      assignRkeyToLocalRead(rec.contentKey, rec.rkey);
      continue;
    }

    // New content from the PDS — land everything in the Book collection
    // with its status preserved. /books filters down to want-to-read for
    // its primary view; /shelf shows the full set. The fallback source is
    // "unknown" so a legacy record without a `source` field doesn't get
    // tagged into a live-sync bucket and wiped by the next external pull.
    const book = shelfRecordToBook(rec.value);
    book.pdsRkey = rec.rkey;
    newBooks.push(book);
  }

  if (newBooks.length) {
    _replaceBooksFromPds([...getBooks(), ...newBooks]);
  }

  // Push-up: local entities that aren't on the PDS yet.
  await pushMissingLocalShelf(session, indexed);
}

/**
 * Assign the PDS rkey to a local book and merge any PDS-sourced metadata
 * (rating, note, status, dates, cover) that the local copy is missing.
 * This propagates edits made on another device during reconcile.
 */
function mergeRkeyAndMetadata(localBook: Book, rkey: string, pdsRecord: ShelfEntryRecord) {
  if (localBook.pdsRkey !== rkey) {
    _setBookPdsRkey(localBook.id, rkey);
  }
  const pdsBook = shelfRecordToBook(pdsRecord);
  _mergeBookFromPds(localBook.id, {
    status: pdsBook.status,
    rating: pdsBook.rating,
    note: pdsBook.note,
    startedAt: pdsBook.startedAt,
    finishedAt: pdsBook.finishedAt,
    imageUrl: pdsBook.imageUrl,
  });
}

function assignRkeyToLocalRead(contentKey: string, rkey: string) {
  const entry = getReadBooks().find((e) => e.key === contentKey);
  if (entry && entry.pdsRkey !== rkey) _setReadPdsRkey(entry.key, rkey);
}

async function pushAllLocalShelf(
  session: OAuthSession,
  books: Book[],
  reads: ReadBookEntry[],
): Promise<void> {
  for (const book of books) {
    if (book.pdsRkey) continue;
    await safePushBook(session, book);
  }
  for (const entry of reads) {
    if (entry.pdsRkey) continue;
    await safePushRead(session, entry);
  }
}

async function pushMissingLocalShelf(
  session: OAuthSession,
  pdsIndexed: IndexedShelfRecord[],
): Promise<void> {
  // Check by content key only (regardless of status) so a book that changed
  // status locally isn't pushed as a duplicate record.
  const pdsContentKeys = new Set(pdsIndexed.map((r) => r.contentKey));
  for (const book of getBooks()) {
    if (pdsContentKeys.has(bookKey(book))) continue;
    if (book.pdsRkey) continue; // optimistic — assume someone else cleaned this up
    await safePushBook(session, book);
  }
  for (const entry of getReadBooks()) {
    if (pdsContentKeys.has(entry.key)) continue;
    if (entry.pdsRkey) continue;
    await safePushRead(session, entry);
  }
}

async function safePushBook(session: OAuthSession, book: Book): Promise<void> {
  try {
    const result = await putRecord(
      session,
      NSID.shelfEntry,
      bookToShelfRecord(book, STATUS.wantToRead),
    );
    _setBookPdsRkey(book.id, result.rkey);
  } catch (err) {
    console.error("[sync] failed to push shelf entry", err);
  }
}

async function safePushRead(session: OAuthSession, entry: ReadBookEntry): Promise<void> {
  try {
    const result = await putRecord(session, NSID.shelfEntry, readEntryToShelfRecord(entry));
    _setReadPdsRkey(entry.key, result.rkey);
  } catch (err) {
    console.error("[sync] failed to push read entry", err);
  }
}

// --- Authors ---

function authorMatchKey(a: AuthorEntry): string {
  return a.olKey ?? a.name.toLowerCase();
}

async function reconcileAuthors(
  session: OAuthSession,
  rawRecords: ListedRecord<AuthorFollowRecord>[],
  opts: AttachOptions,
): Promise<void> {
  // Collapse duplicate author follows on the PDS first so the rest of the
  // reconcile sees one record per author.
  const { unique: records, duplicates } = dedupeAuthorRecords(rawRecords);
  await deleteDuplicateRecords(session, NSID.authorFollow, duplicates, "author follow");

  const localAuthors = getAuthors();

  if (opts.bootstrap && records.length === 0 && localAuthors.length) {
    for (const a of localAuthors) {
      if (a.pdsRkey) continue;
      await safePushAuthor(session, a);
    }
    return;
  }

  const localKeys = new Set(localAuthors.map(authorMatchKey));

  const newLocals: AuthorEntry[] = [];
  for (const rec of records) {
    const k = rec.value.olAuthorKey ?? rec.value.name.toLowerCase();
    if (localKeys.has(k)) {
      const matched = localAuthors.find((a) => authorMatchKey(a) === k);
      if (matched && matched.pdsRkey !== rec.rkey) {
        _setAuthorPdsRkey(matched.id, rec.rkey);
      }
    } else {
      const entry = authorRecordToEntry(rec.value, rec.rkey);
      newLocals.push(entry);
    }
  }
  if (newLocals.length) {
    _replaceAuthorsFromPds([...getAuthors(), ...newLocals]);
  }

  const pdsKeys = new Set(records.map((r) => r.value.olAuthorKey ?? r.value.name.toLowerCase()));
  for (const a of getAuthors()) {
    if (a.pdsRkey) continue;
    const k = authorMatchKey(a);
    if (pdsKeys.has(k)) continue;
    await safePushAuthor(session, a);
  }
}

async function safePushAuthor(session: OAuthSession, author: AuthorEntry): Promise<void> {
  try {
    const result = await putRecord(session, NSID.authorFollow, authorEntryToRecord(author));
    _setAuthorPdsRkey(author.id, result.rkey);
  } catch (err) {
    console.error("[sync] failed to push author follow", err);
  }
}

// --- Dismissed ---

async function reconcileDismissed(
  session: OAuthSession,
  rawRecords: ListedRecord<BookDismissedRecord>[],
  opts: AttachOptions,
): Promise<void> {
  const { unique: records, duplicates } = dedupeDismissedRecords(rawRecords);
  await deleteDuplicateRecords(session, NSID.bookDismissed, duplicates, "dismissed entry");

  const localDismissed = getDismissedWorks();

  if (opts.bootstrap && records.length === 0 && localDismissed.length) {
    for (const d of localDismissed) {
      if (d.pdsRkey) continue;
      await safePushDismissed(session, d);
    }
    return;
  }

  const localKeys = new Set(localDismissed.map((d) => d.key));

  const newLocals: DismissedWorkEntry[] = [];
  for (const rec of records) {
    const entry = dismissedRecordToEntry(rec.value);
    entry.pdsRkey = rec.rkey;
    if (localKeys.has(entry.key)) {
      const matched = localDismissed.find((d) => d.key === entry.key);
      if (matched && matched.pdsRkey !== rec.rkey) {
        _setDismissedPdsRkey(matched.key, rec.rkey);
      }
    } else {
      newLocals.push(entry);
    }
  }
  if (newLocals.length) {
    _replaceDismissedFromPds([...getDismissedWorks(), ...newLocals]);
  }

  const pdsKeys = new Set(records.map((r) => contentKeyForDismissed(r.value)));
  for (const d of getDismissedWorks()) {
    if (d.pdsRkey) continue;
    if (pdsKeys.has(d.key)) continue;
    await safePushDismissed(session, d);
  }
}

function contentKeyForDismissed(record: BookDismissedRecord): string {
  if (record.ids?.olWorkId) return `work:${record.ids.olWorkId}`;
  return `fuzzy:${normalize(record.title ?? "")}\0${normalize(record.authors?.[0]?.name ?? "")}`;
}

async function safePushDismissed(session: OAuthSession, entry: DismissedWorkEntry): Promise<void> {
  const record = dismissedToRecord(entry);
  if (!record) return;
  try {
    const result = await putRecord(session, NSID.bookDismissed, record);
    _setDismissedPdsRkey(entry.key, result.rkey);
  } catch (err) {
    console.error("[sync] failed to push dismissed record", err);
  }
}

// --- Mutation handler: mirror local changes to the PDS ---

function handleMutation(session: OAuthSession, m: StorageMutation): void {
  switch (m.kind) {
    case "book:added":
      void safePushBook(session, m.book);
      return;
    case "book:updated":
      if (m.book.pdsRkey) {
        void putRecord(
          session,
          NSID.shelfEntry,
          bookToShelfRecord(m.book, STATUS.wantToRead),
          m.book.pdsRkey,
        ).catch((err) => console.error("[sync] failed to update shelf entry", err));
      } else {
        void safePushBook(session, m.book);
      }
      return;
    case "book:removed":
      if (m.book.pdsRkey) {
        void deleteRecord(session, NSID.shelfEntry, m.book.pdsRkey).catch((err) =>
          console.error("[sync] failed to delete shelf entry", err),
        );
      }
      return;
    case "books:bulkSet":
      void reconcileBulkBooks(session, m.previous, m.next);
      return;
    case "author:added":
      void safePushAuthor(session, m.author);
      return;
    case "author:updated":
      if (m.author.pdsRkey) {
        // putRecord with rkey replaces the existing PDS record in place.
        void putRecord(
          session,
          NSID.authorFollow,
          authorEntryToRecord(m.author),
          m.author.pdsRkey,
        ).catch((err) => console.error("[sync] failed to update author follow", err));
      } else {
        // Local entry never made it up before — push as a new record.
        void safePushAuthor(session, m.author);
      }
      return;
    case "author:removed":
      if (m.author.pdsRkey) {
        void deleteRecord(session, NSID.authorFollow, m.author.pdsRkey).catch((err) =>
          console.error("[sync] failed to delete author follow", err),
        );
      }
      return;
    case "read:added":
      void safePushRead(session, m.entry);
      return;
    case "read:removed":
      if (m.entry.pdsRkey) {
        void deleteRecord(session, NSID.shelfEntry, m.entry.pdsRkey).catch((err) =>
          console.error("[sync] failed to delete read entry", err),
        );
      }
      return;
    case "dismissed:added":
      void safePushDismissed(session, m.entry);
      return;
    case "dismissed:removed":
      if (m.entry.pdsRkey) {
        void deleteRecord(session, NSID.bookDismissed, m.entry.pdsRkey).catch((err) =>
          console.error("[sync] failed to delete dismissed entry", err),
        );
      }
      return;
  }
}

/**
 * Diff old vs new books list (from a CSV import / BookHive sync) and propagate
 * the additions/removals to the PDS. Books that survived the import keep their
 * pdsRkey because storage merges them in place.
 *
 * Two guards keep this from generating duplicate PDS records when a book's
 * `bookKey` shifts between previous and next (e.g. workId enrichment, or an
 * author normalization difference between the local cache and the imported
 * source):
 *
 *  1. A book in `next` that already carries a pdsRkey is treated as
 *     already-mirrored — even if its bookKey is "new" in this import — so
 *     `safePushBook` (which always createRecord's) doesn't fire.
 *  2. A removal in `previous` is suppressed when its pdsRkey is still
 *     referenced by a book in `next`. Otherwise the same key-drift would
 *     delete the live record we just decided to keep.
 */
async function reconcileBulkBooks(
  session: OAuthSession,
  previous: Book[],
  next: Book[],
): Promise<void> {
  const prevByKey = new Map(previous.map((b) => [bookKey(b), b]));
  const nextByKey = new Map(next.map((b) => [bookKey(b), b]));
  const nextRkeys = new Set(next.flatMap((b) => (b.pdsRkey ? [b.pdsRkey] : [])));

  // Removals: in previous but not in next, and the rkey isn't still in use.
  for (const [k, prev] of prevByKey) {
    if (nextByKey.has(k)) continue;
    if (!prev.pdsRkey) continue;
    if (nextRkeys.has(prev.pdsRkey)) continue;
    try {
      await deleteRecord(session, NSID.shelfEntry, prev.pdsRkey);
    } catch (err) {
      console.error("[sync] bulk: failed to delete shelf entry", err);
    }
  }

  // Additions: in next but not in previous, and not already mirrored.
  for (const [k, nxt] of nextByKey) {
    if (prevByKey.has(k)) continue;
    if (nxt.pdsRkey) continue;
    await safePushBook(session, nxt);
  }
}

/**
 * Re-run reconcile (without bootstrap semantics). Useful as a public
 * "force resync" hook from the UI.
 */
export async function resync(): Promise<void> {
  if (!activeSession) return;
  await reconcile(activeSession, {});
}
