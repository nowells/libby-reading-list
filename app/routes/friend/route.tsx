import { Link, redirect, useParams, useSearchParams } from "react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { usePostHog } from "@posthog/react";
import { initSession } from "~/lib/atproto";
import { statusTokenName, type ShelfEntryRecord } from "~/lib/atproto/lexicon";
import {
  addBook,
  addAuthor,
  getAuthors,
  getBooks,
  getLibraries,
  getReadBooks,
  readBookKey,
  type AuthorEntry,
  type Book,
  type LibraryConfig,
  type ShelfStatus,
} from "~/lib/storage";
import { bookKey } from "~/lib/dedupe";
import { effectiveStatus, statusLabel } from "~/components/shelf-status";
import { useFriends } from "~/routes/friends/hooks/use-friends";
import type { FriendShelf } from "~/lib/atproto/friends";
import { BookCard } from "~/routes/books/components/book-card";
import { fuzzyMatch, PAGE_SIZE } from "~/routes/books/lib/utils";
import { useAvailabilityChecker } from "~/routes/books/hooks/use-availability-checker";
import type { BookAvailState } from "~/routes/books/lib/categorize";

export const handle = {
  navActive: "friends",
  pageTitle: (data: unknown) => {
    const friend = (data as { friend?: FriendShelf } | undefined)?.friend;
    if (!friend) return "Friend";
    return friend.profile.displayName ?? friend.profile.handle;
  },
};

export function meta({ data }: { data: { friend?: FriendShelf } | undefined }) {
  const name = data?.friend?.profile.displayName ?? data?.friend?.profile.handle;
  return [{ title: name ? `${name} | ShelfCheck` : "Friend | ShelfCheck" }];
}

export function clientLoader() {
  // Friends only show up after the user has at least added a library — they
  // need the rest of the app working before this view makes sense.
  if (getLibraries().length === 0) {
    throw redirect("/setup");
  }
  return {};
}

type StatusFilter = "all" | ShelfStatus;
const STATUS_FILTERS: StatusFilter[] = ["wantToRead", "reading", "finished", "abandoned", "all"];

/**
 * Each card on this page kicks off a Libby availability check against the
 * viewer's libraries — possibly several requests per book if the work has
 * alternate-edition ISBNs. Cap the page size lower than /books so a friend
 * with hundreds of finished reads doesn't trigger a fan-out of network
 * requests just for browsing one shelf.
 */
const FRIEND_PAGE_SIZE = Math.min(PAGE_SIZE, 10);

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function formatStaleAge(refreshedAt: number, now = Date.now()): string {
  const diffMs = Math.max(0, now - refreshedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/**
 * Translate a friend's `ShelfEntryRecord` into the `Book` shape that
 * `BookCard` consumes. The synthesized book carries no local id (it's never
 * persisted) and represents *the friend's view of the work*. When the
 * viewer has the same book on their own shelf, the route swaps this for
 * the viewer's `Book` so the card surfaces my status / rating / note.
 */
function recordToBook(entry: ShelfEntryRecord): Book {
  const author = entry.authors?.[0]?.name ?? "Unknown";
  const friendStatus = statusTokenName(entry.status);
  const status: ShelfStatus | undefined =
    friendStatus === "wantToRead" ||
    friendStatus === "reading" ||
    friendStatus === "finished" ||
    friendStatus === "abandoned"
      ? friendStatus
      : undefined;
  return {
    id: `friend-${entry.ids.olWorkId ?? `${entry.title}\0${author}`}`,
    title: entry.title,
    author,
    workId: entry.ids.olWorkId,
    isbn13: entry.ids.isbn13,
    imageUrl: entry.coverUrl,
    source: "unknown",
    subjects: entry.subjects,
    pageCount: entry.pageCount,
    firstPublishYear: entry.firstPublishYear,
    rating: entry.rating,
    note: entry.note,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    status,
  };
}

/**
 * Match a friend's entry against the viewer's local shelf.
 * Uses {@link bookKey} so the equivalence is the same as the local dedupe.
 */
function findOwnedBook(entry: ShelfEntryRecord, byKey: Map<string, Book>): Book | undefined {
  const key = bookKey(recordToBook(entry));
  return byKey.get(key);
}

export default function FriendDetail() {
  const posthog = usePostHog();
  const { handle: handleParam } = useParams();
  const [session, setSession] = useState<OAuthSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    initSession().then((result) => {
      if (result) setSession(result.session);
      setSessionChecked(true);
    });
  }, []);

  const { friends, status, refreshing, refreshFriend, refreshingDids } = useFriends(session);

  const [libraries] = useState<LibraryConfig[]>(() => getLibraries());
  const [myBooks, setMyBooks] = useState<Book[]>(() => getBooks());
  const [myAuthors, setMyAuthors] = useState<AuthorEntry[]>(() => getAuthors());
  const myReadKeys = useMemo(() => new Set(getReadBooks().map((r) => r.key)), [myBooks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hash my books by dedupe key so each friend entry is matched in O(1).
  const myBooksByKey = useMemo(() => {
    const map = new Map<string, Book>();
    for (const b of myBooks) map.set(bookKey(b), b);
    return map;
  }, [myBooks]);

  const myAuthorNames = useMemo(
    () => new Set(myAuthors.map((a) => a.name.toLowerCase())),
    [myAuthors],
  );

  // Find the friend by handle (URL slug). Match against profile.handle —
  // ATproto handles can change, so a stale URL falls through to the
  // not-found state and the user can refresh from /friends.
  const friend = useMemo(
    () => friends.find((f) => f.profile.handle === handleParam),
    [friends, handleParam],
  );

  /**
   * Filter and pagination live in the URL so:
   *  - Pill clicks and pagination clicks update history (deep-linkable).
   *  - The URL is the single source of truth, so any pill or button click
   *    flows through `setSearchParams` and the component re-reads the new
   *    state on the next render. This matches the /books pattern.
   *
   * Default = "all". Friends often have a shelf skewed entirely to one
   * status (e.g. Goodreads import = all want-to-read; long-time reader =
   * mostly finished), so any other default would land users on an empty
   * page and look broken.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const rawStatus = searchParams.get("status");
  const statusFilter: StatusFilter =
    rawStatus === "wantToRead" ||
    rawStatus === "reading" ||
    rawStatus === "finished" ||
    rawStatus === "abandoned" ||
    rawStatus === "all"
      ? rawStatus
      : "all";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const [searchQuery, setSearchQuery] = useState("");

  const updateSearchParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const handleStatusFilter = useCallback(
    (s: StatusFilter) => {
      // "all" is the default — drop the param so the URL stays clean. Any
      // pill click also resets to page 1.
      if (s === "all") {
        updateSearchParams({ status: null, page: null });
      } else {
        updateSearchParams({ status: s, page: null });
      }
    },
    [updateSearchParams],
  );

  const goToPage = useCallback(
    (p: number) => {
      // Page 1 is the default — drop the param so the URL stays clean.
      updateSearchParams({ page: p === 1 ? null : String(p) });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [updateSearchParams],
  );

  const handleSearchChange = useCallback(
    (q: string) => {
      setSearchQuery(q);
      updateSearchParams({ page: null });
    },
    [updateSearchParams],
  );

  // Friend's own status counts — drives the status pill labels.
  const friendStatusCounts = useMemo(() => {
    const c: Record<ShelfStatus, number> = {
      wantToRead: 0,
      reading: 0,
      finished: 0,
      abandoned: 0,
    };
    if (!friend) return c;
    for (const e of friend.entries) {
      const s = statusTokenName(e.status);
      if (s === "wantToRead" || s === "reading" || s === "finished" || s === "abandoned") {
        c[s]++;
      }
    }
    return c;
  }, [friend]);

  /**
   * Each visible row is "for this friend's entry, what does the viewer have?"
   * The card renders the viewer's book when one exists (so my status / rating
   * / note show through); otherwise it falls back to the friend-derived stub
   * with `hideStatusPill` set so we don't pretend it's mine.
   */
  type Row = {
    /** Friend's record — always present, drives status filtering. */
    entry: ShelfEntryRecord;
    /** My book for this work, if I own it. */
    mine?: Book;
    /** The book passed to BookCard — `mine ?? recordToBook(entry)`. */
    displayBook: Book;
    /** Stable key for React. */
    key: string;
  };

  const rows: Row[] = useMemo(() => {
    if (!friend) return [];
    return friend.entries.map((entry) => {
      const fromRecord = recordToBook(entry);
      const mine = findOwnedBook(entry, myBooksByKey);
      return {
        entry,
        mine,
        displayBook: mine ?? fromRecord,
        key: entry.ids.olWorkId ?? `${entry.title}\0${entry.authors?.[0]?.name ?? ""}`,
      };
    });
  }, [friend, myBooksByKey]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (statusFilter !== "all") {
      list = list.filter((r) => statusTokenName(r.entry.status) === statusFilter);
    }
    if (searchQuery.trim()) {
      list = list.filter((r) => fuzzyMatch(searchQuery, r.entry.title, r.displayBook.author));
    }
    return list;
  }, [rows, statusFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / FRIEND_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = useMemo(
    () => filteredRows.slice((safePage - 1) * FRIEND_PAGE_SIZE, safePage * FRIEND_PAGE_SIZE),
    [filteredRows, safePage],
  );

  /**
   * Only the visible page's books are sent to the availability checker — the
   * whole reason for paginating this view is so a friend with hundreds of
   * finished reads doesn't fan out into hundreds of Libby lookups. The
   * checker caches per book.id in localStorage, so flipping pages back to a
   * previously-loaded one rehydrates from cache without re-fetching.
   *
   * For owned books, displayBook.id is the viewer's local Book id, which
   * means the cache hit is shared with /books — already-checked want-to-read
   * books appear instantly here.
   */
  const visibleBooks = useMemo(() => paginatedRows.map((r) => r.displayBook), [paginatedRows]);

  const handleBookEnriched = useCallback((bookId: string, updates: Partial<Book>) => {
    // Friend's synthesized books have ids like `friend-OL...` and won't
    // match any local Book — the map is a no-op for those. For owned
    // books, the id matches and we update the local cache so the next
    // render sees the enriched workId / canonicalTitle / etc.
    setMyBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, ...updates } : b)));
  }, []);

  const { availMap, refreshBook } = useAvailabilityChecker(visibleBooks, libraries, {
    onBookEnriched: handleBookEnriched,
  });

  const handleLibbyClick = (bookTitle: string, formatType: string, isAvailable: boolean) => {
    posthog?.capture("friend_libby_link_clicked", {
      friend_handle: handleParam,
      book_title: bookTitle,
      format_type: formatType,
      is_available: isAvailable,
    });
  };

  /**
   * Adopt one of the friend's entries onto my own shelf as want-to-read. We
   * deliberately keep this as a one-shot side-effect (not an update of the
   * friend's record) — adding via the existing `addBook` path means the
   * viewer's PDS sync engine handles propagation just like any other manual
   * add.
   */
  const handleAdd = (entry: ShelfEntryRecord) => {
    const author = entry.authors?.[0]?.name ?? "Unknown";
    addBook({
      title: entry.title,
      author,
      source: "unknown",
      workId: entry.ids.olWorkId,
      isbn13: entry.ids.isbn13,
      imageUrl: entry.coverUrl,
      subjects: entry.subjects,
      pageCount: entry.pageCount,
      firstPublishYear: entry.firstPublishYear,
      // Default to want-to-read regardless of the friend's status — the
      // user said "make a book that THEY read to be MY want to read".
      status: "wantToRead",
    });
    setMyBooks(getBooks());
  };

  const handleFollowAuthor = (entry: ShelfEntryRecord) => {
    const author = entry.authors?.[0];
    if (!author) return;
    addAuthor({ name: author.name, olKey: author.olAuthorKey });
    setMyAuthors(getAuthors());
  };

  const isFriendRefreshing = friend ? refreshingDids.has(friend.profile.did) : false;
  const isStale =
    friend?.refreshedAt != null && Date.now() - friend.refreshedAt > STALE_THRESHOLD_MS;

  // ------------------------- Render -------------------------

  if (sessionChecked && !session) {
    return (
      <main className="min-h-screen py-8 px-4">
        <div className="max-w-3xl mx-auto">
          <Link to="/friends" className="text-sm text-purple-600 hover:text-purple-700">
            ← Back to friends
          </Link>
          <div className="mt-4 text-center py-12 px-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
            <p className="text-gray-600 dark:text-gray-300 mb-2 font-medium">
              Sign in with Bluesky to view friends
            </p>
            <Link
              to="/setup"
              className="inline-flex items-center gap-2 mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              Go to Settings
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // Initial load: friends cache empty + still discovering. Show a placeholder.
  if (!friend && (status === "loading" || (status === "idle" && !sessionChecked))) {
    return (
      <main className="min-h-screen py-8 px-4">
        <div className="max-w-3xl mx-auto">
          <Link to="/friends" className="text-sm text-purple-600 hover:text-purple-700">
            ← Back to friends
          </Link>
          <div className="mt-4 text-center py-12 px-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
            <svg
              className="w-8 h-8 animate-spin text-purple-500 mx-auto mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <p className="text-gray-600 dark:text-gray-300">Loading friend's shelf…</p>
          </div>
        </div>
      </main>
    );
  }

  if (!friend) {
    return (
      <main className="min-h-screen py-8 px-4">
        <div className="max-w-3xl mx-auto">
          <Link to="/friends" className="text-sm text-purple-600 hover:text-purple-700">
            ← Back to friends
          </Link>
          <div className="mt-4 text-center py-12 px-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
            <p className="text-gray-600 dark:text-gray-300 mb-2 font-medium">Friend not found</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
              Could not find <span className="font-mono">@{handleParam}</span> in your friends list.
              They may have changed handles, or you may need to refresh.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link to="/friends" className="text-sm text-purple-600 hover:text-purple-700">
          ← Back to friends
        </Link>

        {/* Friend metadata header */}
        <header className="mt-4 mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-4">
          {friend.profile.avatar ? (
            <img
              src={friend.profile.avatar}
              alt=""
              className="w-14 h-14 rounded-full flex-shrink-0 object-cover"
            />
          ) : (
            <div className="w-14 h-14 rounded-full flex-shrink-0 bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <span className="text-lg font-medium text-purple-600 dark:text-purple-400">
                {(friend.profile.displayName ?? friend.profile.handle)[0]?.toUpperCase()}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">
              {friend.profile.displayName ?? friend.profile.handle}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              @{friend.profile.handle}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {friend.entries.length} {friend.entries.length === 1 ? "book" : "books"}
              {isStale && friend.refreshedAt != null && (
                <span
                  className="ml-1 text-amber-600 dark:text-amber-400"
                  title={`Last refresh from this friend's PDS was ${formatStaleAge(friend.refreshedAt)}. Their server may be unreachable.`}
                >
                  · stale, last seen {formatStaleAge(friend.refreshedAt)}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => refreshFriend(friend.profile.did)}
            disabled={isFriendRefreshing || refreshing}
            aria-label={`Refresh ${friend.profile.displayName ?? friend.profile.handle}'s reading list`}
            className="flex-shrink-0 p-2 rounded-full text-gray-400 hover:text-purple-600 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            title="Refresh reading list"
          >
            <svg
              className={`w-4 h-4 ${isFriendRefreshing ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </header>

        {/* Status pills — filter by FRIEND's status. */}
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          {STATUS_FILTERS.map((s) => {
            const active = statusFilter === s;
            const count = s === "all" ? friend.entries.length : friendStatusCounts[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => handleStatusFilter(s)}
                aria-pressed={active}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  active
                    ? "bg-purple-600 border-purple-600 text-white"
                    : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                }`}
              >
                {s === "all" ? "All" : statusLabel(s)} ({count})
              </button>
            );
          })}
        </div>

        {friend.entries.length > 0 && (
          <div className="relative mb-4">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search title or author..."
              className="w-full pl-10 pr-9 py-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-400 dark:focus:ring-purple-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => handleSearchChange("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {filteredRows.length === 0 ? (
          <div className="text-center py-8 px-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {searchQuery.trim()
                ? `No books matching "${searchQuery.trim()}".`
                : "No books in this category."}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {paginatedRows.map((row) => (
              <FriendBookRow
                key={row.key}
                row={row}
                state={availMap[row.displayBook.id] ?? { status: "pending" }}
                libraries={libraries}
                friendStatus={statusTokenName(row.entry.status)}
                onAdd={() => handleAdd(row.entry)}
                onFollowAuthor={
                  row.entry.authors?.[0]?.name ? () => handleFollowAuthor(row.entry) : undefined
                }
                onRefresh={() => refreshBook(row.displayBook)}
                onLibbyClick={handleLibbyClick}
                isAuthorFollowed={
                  row.entry.authors?.[0]
                    ? myAuthorNames.has(row.entry.authors[0].name.toLowerCase())
                    : false
                }
                isRead={myReadKeys.has(
                  readBookKey({
                    workId: row.entry.ids.olWorkId,
                    title: row.entry.title,
                    author: row.entry.authors?.[0]?.name ?? "",
                  }),
                )}
              />
            ))}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-8">
            <button
              onClick={() => goToPage(1)}
              disabled={safePage <= 1}
              className="px-2.5 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title="First page"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5"
                />
              </svg>
            </button>
            <button
              onClick={() => goToPage(safePage - 1)}
              disabled={safePage <= 1}
              className="px-2.5 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Previous page"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5L8.25 12l7.5-7.5"
                />
              </svg>
            </button>
            <span className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              Page {safePage} of {totalPages}
            </span>
            <button
              onClick={() => goToPage(safePage + 1)}
              disabled={safePage >= totalPages}
              className="px-2.5 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Next page"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
            <button
              onClick={() => goToPage(totalPages)}
              disabled={safePage >= totalPages}
              className="px-2.5 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Last page"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5.25 4.5l7.5 7.5-7.5 7.5m6-15l7.5 7.5-7.5 7.5"
                />
              </svg>
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

interface FriendBookRowProps {
  row: {
    entry: ShelfEntryRecord;
    mine?: Book;
    displayBook: Book;
  };
  state: BookAvailState;
  libraries: LibraryConfig[];
  friendStatus: string | undefined;
  onAdd: () => void;
  onFollowAuthor?: () => void;
  onRefresh?: () => void;
  onLibbyClick?: (bookTitle: string, formatType: string, isAvailable: boolean) => void;
  isAuthorFollowed: boolean;
  isRead: boolean;
}

/**
 * One row on the friend detail page. Reuses BookCard for visual continuity
 * with /books — the only restrictions are on edit-style actions, which the
 * viewer obviously can't do on someone else's record. Libby availability
 * IS shown (paginated, page-bounded so we don't fan out hundreds of
 * lookups for a single browse), because the most useful question on this
 * page is "can I borrow this from MY library right now?" — and the answer
 * is independent of the friend's status on the book.
 */
function FriendBookRow({
  row,
  state,
  libraries,
  friendStatus,
  onAdd,
  onFollowAuthor,
  onRefresh,
  onLibbyClick,
  isAuthorFollowed,
  isRead,
}: FriendBookRowProps) {
  const owned = !!row.mine;
  const myStatus = row.mine ? effectiveStatus(row.mine) : undefined;

  // The action / "on your shelf" indicator used to ride in `headerExtras`
  // alongside the kebab in the title row. On mobile that forced the
  // (already narrow) title column to wrap because `flex-1 min-w-0` had to
  // share the row with a 14ch button. Move the affordance into the
  // metadata row below the title — it already wraps gracefully and is
  // a more natural spot for "viewer's relationship to this book".
  const ownershipAction = owned ? (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
      title={myStatus ? `On your shelf as ${statusLabel(myStatus)}` : "On your shelf"}
    >
      <svg
        className="w-3 h-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
      On your shelf
    </span>
  ) : (
    <button
      type="button"
      onClick={onAdd}
      className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
      aria-label={`Add ${row.entry.title} to your want-to-read shelf`}
    >
      <svg
        className="w-3 h-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      Add to Want to Read
    </button>
  );

  // Friend's rating / status — extra context shown in the metadata row so
  // the viewer can see "they rated this 5★" alongside their own status.
  const friendStatusLabel =
    friendStatus === "wantToRead"
      ? "Want to read"
      : friendStatus === "reading"
        ? "Reading"
        : friendStatus === "finished"
          ? "Finished"
          : friendStatus === "abandoned"
            ? "Abandoned"
            : null;

  const friendBadge = (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
      <svg
        className="w-3 h-3 opacity-70"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
        />
      </svg>
      {friendStatusLabel ?? "Their shelf"}
      {row.entry.rating != null && row.entry.rating > 0 && (
        <span className="text-amber-500">
          {" · "}
          {"★".repeat(Math.round(row.entry.rating / 20))}
        </span>
      )}
    </span>
  );

  return (
    <BookCard
      book={row.displayBook}
      state={state}
      libraries={libraries}
      formatFilter="all"
      isRead={isRead}
      isAuthorFollowed={isAuthorFollowed}
      onFollowAuthor={onFollowAuthor}
      onRefresh={onRefresh}
      onLibbyClick={onLibbyClick}
      showAvailability={libraries.length > 0}
      hideStatusPill={!owned}
      belowStatusExtras={
        <>
          {ownershipAction}
          {friendBadge}
        </>
      }
    />
  );
}
