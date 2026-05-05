import { usePostHog } from "@posthog/react";
import { Link, redirect, useSearchParams } from "react-router";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  getBooks,
  getLibraries,
  getAuthors,
  addBook,
  removeBook,
  updateBook,
  addReadBook,
  removeReadBook,
  getReadBooks,
  readBookKey,
  addAuthor,
  isWantToRead,
  type Book,
  type LibraryConfig,
  type ReadBookEntry,
  type ShelfStatus,
} from "~/lib/storage";
import { enrichBooksWithWorkId } from "~/lib/openlibrary";
import { effectiveStatus, statusLabel, SHELF_STATUSES } from "~/components/shelf-status";
import { bookKey } from "~/lib/dedupe";
import { getAuthor } from "~/components/book-search-utils";
import { BookSearchPicker } from "~/components/book-search-picker";
import type { LibbyMediaItem } from "~/lib/libby";
import { useAvailabilityChecker } from "./hooks/use-availability-checker";
import { useAvailabilityNotifications } from "./hooks/use-availability-notifications";
import {
  categorizeBookWithFormat,
  categoryScore,
  type BookCategory,
  type FormatFilter,
} from "./lib/categorize";
import { timeAgo, PAGE_SIZE, fuzzyMatch } from "./lib/utils";
import { SummaryStats } from "./components/summary-stats";
import { FormatFilterBar } from "./components/format-filter-bar";
import { BookCard } from "./components/book-card";
import { ProgressBar } from "./components/progress-bar";
import { BookhiveSyncStatus } from "./components/bookhive-sync-status";
import { BookEditor, type BookEditorPatch } from "~/components/book-editor";

export const handle = { navActive: "books", pageTitle: "Your books" };

export function meta() {
  return [{ title: "Your Books | ShelfCheck" }];
}

/**
 * Filter values available in the status pill row. "all" shows every entry
 * regardless of status; the other values match `ShelfStatus` exactly.
 */
type StatusFilter = "all" | ShelfStatus;
const STATUS_FILTERS: StatusFilter[] = ["wantToRead", "reading", "finished", "abandoned", "all"];

/**
 * Promote a legacy `ReadBookEntry` (which carries only title/author/workId)
 * into a `Book` view so the unified shelf can render every entry through one
 * card component. The `__readEntryKey` flag tells action handlers to delete
 * via `removeReadBook` instead of `removeBook`.
 */
interface PseudoBook extends Book {
  __readEntryKey?: string;
}

function readEntryToBookView(entry: ReadBookEntry): PseudoBook {
  return {
    id: `read-${entry.key}`,
    title: entry.title,
    author: entry.author,
    workId: entry.workId,
    source: "unknown",
    status: "finished",
    finishedAt: new Date(entry.markedAt).toISOString(),
    pdsRkey: entry.pdsRkey,
    __readEntryKey: entry.key,
  };
}

/** Combine Books and legacy ReadBookEntries into one shelf view, deduped by content key. */
function loadAllShelfEntries(): PseudoBook[] {
  const books = getBooks();
  const reads = getReadBooks();
  const seen = new Set<string>();
  const out: PseudoBook[] = [];
  for (const b of books) {
    seen.add(bookKey(b));
    out.push(b);
  }
  for (const r of reads) {
    if (seen.has(r.key)) continue;
    out.push(readEntryToBookView(r));
  }
  return out;
}

export function clientLoader() {
  const libraries = getLibraries();
  // /books renders even when the user has no books yet (they may want to
  // add one through the search picker, like the old /shelf route allowed),
  // so only the missing-library case bounces back to setup.
  if (libraries.length === 0) {
    throw redirect("/setup");
  }
  return { libraries };
}

export default function Books() {
  const posthog = usePostHog();
  const [entries, setEntries] = useState<PseudoBook[]>(() => loadAllShelfEntries());
  const [libraries] = useState<LibraryConfig[]>(() => getLibraries());
  const [showAddBook, setShowAddBook] = useState(false);
  const [readBooks, setReadBooks] = useState(() => getReadBooks());
  const [followedAuthors, setFollowedAuthors] = useState(() => getAuthors());
  const [editing, setEditing] = useState<PseudoBook | null>(null);
  const [finding, setFinding] = useState<PseudoBook | null>(null);
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<
    { id: number; message: string; type: "success" | "error" }[]
  >([]);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  const refreshEntries = useCallback(() => setEntries(loadAllShelfEntries()), []);

  const readBookKeys = useMemo(() => new Set(readBooks.map((r) => r.key)), [readBooks]);
  const followedAuthorNames = useMemo(
    () => new Set(followedAuthors.map((a) => a.name.toLowerCase())),
    [followedAuthors],
  );

  // Want-to-read books drive the Libby availability check regardless of
  // which status the user is currently filtering to. We never want to
  // hammer the Libby API on a `finished` book the user already read.
  const wantToReadBooks = useMemo(() => entries.filter(isWantToRead), [entries]);

  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const statusFilter: StatusFilter =
    (STATUS_FILTERS.find((s) => s === searchParams.get("status")) as StatusFilter) ?? "wantToRead";

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<BookCategory | null>(null);
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const handleBookEnriched = useCallback((bookId: string, updates: Partial<Book>) => {
    setEntries((prev) => prev.map((b) => (b.id === bookId ? { ...b, ...updates } : b)));
  }, []);

  const {
    availMap,
    checkedCount,
    loadingCount,
    totalBooks,
    refreshBook,
    refreshAll,
    oldestFetchedAt,
    enrichmentProgress,
  } = useAvailabilityChecker(wantToReadBooks, libraries, { onBookEnriched: handleBookEnriched });

  useAvailabilityNotifications(wantToReadBooks, availMap, checkedCount, totalBooks);

  useEffect(() => {
    posthog?.capture("books_page_viewed", {
      entry_count: entries.length,
      want_to_read_count: wantToReadBooks.length,
      library_count: libraries.length,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statusCounts = useMemo(() => {
    const c: Record<ShelfStatus, number> = {
      wantToRead: 0,
      reading: 0,
      finished: 0,
      abandoned: 0,
    };
    for (const e of entries) c[effectiveStatus(e)]++;
    return c;
  }, [entries]);

  const showAvailabilityFilters = statusFilter === "wantToRead";

  const categoryCounts = useMemo(() => {
    const counts = { available: 0, soon: 0, waiting: 0, not_found: 0 };
    if (!showAvailabilityFilters) return counts;
    for (const book of wantToReadBooks) {
      const cat = categorizeBookWithFormat(availMap[book.id], formatFilter);
      if (cat !== "pending" && cat in counts) {
        counts[cat as keyof typeof counts]++;
      }
    }
    return counts;
  }, [wantToReadBooks, availMap, formatFilter, showAvailabilityFilters]);

  const sortedAndFilteredEntries = useMemo(() => {
    let filtered = entries.filter((e) =>
      statusFilter === "all" ? true : effectiveStatus(e) === statusFilter,
    );

    if (searchQuery.trim()) {
      filtered = filtered.filter((b) => fuzzyMatch(searchQuery, b.title, b.author));
    }

    if (showAvailabilityFilters && categoryFilter) {
      filtered = filtered.filter(
        (b) => categorizeBookWithFormat(availMap[b.id], formatFilter) === categoryFilter,
      );
    }

    if (showAvailabilityFilters) {
      // Want-to-read view: sort by availability category (ready → soon → wait
      // → not found), tiebreak by title. This matches the previous /books UX.
      filtered.sort((a, b) => {
        const scoreA = categoryScore(categorizeBookWithFormat(availMap[a.id], formatFilter));
        const scoreB = categoryScore(categorizeBookWithFormat(availMap[b.id], formatFilter));
        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.title.localeCompare(b.title);
      });
    } else {
      // Reading-history views: most recently touched first. finishedAt
      // wins, then startedAt, then title.
      filtered.sort((a, b) => {
        const aT = Date.parse(a.finishedAt ?? a.startedAt ?? "") || 0;
        const bT = Date.parse(b.finishedAt ?? b.startedAt ?? "") || 0;
        if (aT !== bT) return bT - aT;
        return a.title.localeCompare(b.title);
      });
    }

    return filtered;
  }, [
    entries,
    statusFilter,
    availMap,
    categoryFilter,
    formatFilter,
    searchQuery,
    showAvailabilityFilters,
  ]);

  const totalPages = Math.max(1, Math.ceil(sortedAndFilteredEntries.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedEntries = sortedAndFilteredEntries.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const updateSearchParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(updates)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const goToPage = (p: number) => {
    updateSearchParams({ page: String(p) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    updateSearchParams({ page: "1" });
  };

  const handleStatusFilter = (s: StatusFilter) => {
    if (s === "wantToRead") {
      // wantToRead is the default — drop the param so the URL stays clean.
      updateSearchParams({ status: null, page: "1" });
    } else {
      updateSearchParams({ status: s, page: "1" });
    }
    // Category filter only makes sense in want-to-read view; clear it when
    // we navigate elsewhere.
    if (s !== "wantToRead") setCategoryFilter(null);
    posthog?.capture("books_status_filter_changed", { status: s });
  };

  const handleToggleCategory = (cat: BookCategory) => {
    const newFilter = categoryFilter === cat ? null : cat;
    setCategoryFilter(newFilter);
    updateSearchParams({ page: "1" });
    posthog?.capture("category_filter_toggled", {
      category: cat,
      active: newFilter === cat,
    });
  };

  const handleToggleFormat = (f: FormatFilter) => {
    setFormatFilter(f);
    updateSearchParams({ page: "1" });
    posthog?.capture("format_filter_toggled", { format: f });
  };

  const handleRefreshAll = () => {
    posthog?.capture("all_books_refreshed", {
      book_count: wantToReadBooks.length,
      library_count: libraries.length,
    });
    refreshAll();
  };

  const handleLibbyClick = (bookTitle: string, formatType: string, isAvailable: boolean) => {
    posthog?.capture("libby_link_clicked", {
      book_title: bookTitle,
      format_type: formatType,
      is_available: isAvailable,
    });
  };

  const handleSelectBook = (item: LibbyMediaItem) => {
    const author = getAuthor(item);
    addBook({
      title: item.title,
      author,
      imageUrl: item.covers?.cover150Wide?.href,
      source: "unknown",
    });
    refreshEntries();
    setShowAddBook(false);
    posthog?.capture("book_added_from_search", { title: item.title });
  };

  const handleRemoveEntry = (entry: PseudoBook) => {
    if (!confirm(`Remove "${entry.title}" from your shelf?`)) return;
    if (entry.__readEntryKey) {
      removeReadBook(entry.__readEntryKey);
    } else {
      removeBook(entry.id);
    }
    refreshEntries();
    setReadBooks(getReadBooks());
    posthog?.capture("book_removed", { book_id: entry.id });
  };

  /**
   * "Mark as read" is kept as a one-tap shortcut from the want-to-read view:
   * it adds a `ReadBookEntry` (which is what BookHive / external sources
   * historically wrote). When invoked from a card whose Book exists, we
   * keep both records — `ReadBookEntry` is keyed independently and the
   * sync engine will reconcile it.
   */
  const handleMarkRead = (book: PseudoBook) => {
    const key = readBookKey({ workId: book.workId, title: book.title, author: book.author });
    if (readBookKeys.has(key)) {
      removeReadBook(key);
      posthog?.capture("book_unmarked_read", { book_id: book.id });
    } else {
      addReadBook({ key, title: book.title, author: book.author, workId: book.workId });
      posthog?.capture("book_marked_read", { book_id: book.id });
    }
    setReadBooks(getReadBooks());
  };

  const handleQuickStatus = (book: PseudoBook, status: ShelfStatus) => {
    if (book.__readEntryKey) {
      // ReadBookEntry → promote to a real Book before applying status.
      const { __readEntryKey, id: _pseudoId, ...bookData } = book;
      addBook({ ...bookData, status });
      removeReadBook(__readEntryKey);
    } else {
      updateBook(book.id, { status });
    }
    refreshEntries();
    setReadBooks(getReadBooks());
    posthog?.capture("book_quick_status_changed", { book_id: book.id, status });
  };

  const handleEditSave = (entry: PseudoBook, patch: BookEditorPatch) => {
    let bookId: string;
    if (entry.__readEntryKey) {
      const { __readEntryKey, id: _pseudoId, ...bookData } = entry;
      addBook({ ...bookData, ...patch });
      removeReadBook(__readEntryKey);
      const allBooks = getBooks();
      bookId = allBooks[allBooks.length - 1].id;
    } else {
      bookId = entry.id;
      updateBook(bookId, patch);
    }
    setEditing(null);
    refreshEntries();
    setReadBooks(getReadBooks());
    posthog?.capture("book_edited", {
      book_id: bookId,
      status: patch.status,
      has_rating: patch.rating !== undefined,
      has_note: !!patch.note,
    });
  };

  const handleFindSelect = (entry: PseudoBook, item: LibbyMediaItem) => {
    const author = getAuthor(item);
    const imageUrl = item.covers?.cover150Wide?.href;

    let bookId: string;
    if (entry.__readEntryKey) {
      const newBook: Omit<Book, "id" | "manual"> = {
        title: item.title,
        author,
        source: "unknown",
        status: entry.status ?? "finished",
        finishedAt: entry.finishedAt,
        startedAt: entry.startedAt,
        ...(imageUrl ? { imageUrl } : {}),
      };
      addBook(newBook);
      removeReadBook(entry.__readEntryKey);
      const allBooks = getBooks();
      bookId = allBooks[allBooks.length - 1].id;
    } else {
      bookId = entry.id;
      updateBook(bookId, {
        title: item.title,
        author,
        ...(imageUrl ? { imageUrl } : {}),
        source: entry.source,
      });
    }

    setFinding(null);
    setEnrichingIds((prev) => new Set(prev).add(bookId));
    refreshEntries();
    posthog?.capture("book_find_selected", { book_id: bookId, selected_title: item.title });

    enrichBooksWithWorkId([
      {
        id: bookId,
        title: item.title,
        author,
        source: entry.source,
        status: entry.status,
      },
    ])
      .then((enriched) => {
        if (enriched[0]?.workId) {
          const {
            workId,
            isbn13,
            canonicalTitle,
            canonicalAuthor,
            subjects,
            pageCount,
            firstPublishYear,
          } = enriched[0];
          updateBook(bookId, {
            workId,
            isbn13,
            imageUrl: enriched[0].imageUrl ?? imageUrl,
            canonicalTitle,
            canonicalAuthor,
            subjects,
            pageCount,
            firstPublishYear,
          });
          refreshEntries();
          showToast(`Matched "${item.title}" with Open Library`);
        } else {
          showToast(`Could not find "${item.title}" on Open Library`, "error");
        }
      })
      .catch(() => {
        showToast(`Failed to enrich "${item.title}"`, "error");
      })
      .finally(() => {
        setEnrichingIds((prev) => {
          const next = new Set(prev);
          next.delete(bookId);
          return next;
        });
      });
  };

  const handleFollowAuthor = (book: PseudoBook) => {
    const authorName = book.canonicalAuthor ?? book.author;
    if (!authorName) return;
    addAuthor({ name: authorName });
    setFollowedAuthors(getAuthors());
    posthog?.capture("author_followed_from_book", { author: authorName, book_id: book.id });
  };

  const showProgressBar =
    showAvailabilityFilters &&
    wantToReadBooks.length > 0 &&
    (checkedCount < totalBooks || enrichmentProgress);

  return (
    <main className="min-h-screen py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex-1 min-w-0 truncate">
              Your books
            </h1>
            <button
              onClick={() => setShowAddBook((s) => !s)}
              aria-label="Add"
              className="inline-flex items-center gap-1 text-sm font-medium text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span>Add</span>
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {entries.length} {entries.length === 1 ? "book" : "books"} &middot; {libraries.length}{" "}
            {libraries.length === 1 ? "library" : "libraries"}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <BookhiveSyncStatus onBooksChanged={refreshEntries} />
            {showAvailabilityFilters && oldestFetchedAt && checkedCount > 0 && (
              <button
                type="button"
                onClick={handleRefreshAll}
                disabled={loadingCount > 0 || enrichmentProgress !== null}
                title="Refresh Libby availability"
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-70 whitespace-nowrap"
              >
                <svg
                  className={`w-3 h-3 ${loadingCount > 0 || enrichmentProgress ? "animate-spin" : ""}`}
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
                <span>
                  {enrichmentProgress
                    ? `Enriching from Open Library... ${enrichmentProgress.done}/${enrichmentProgress.total}`
                    : loadingCount > 0
                      ? `Syncing Libby... ${checkedCount}/${totalBooks}`
                      : `Synced from Libby ${timeAgo(oldestFetchedAt)}`}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Status filter pills (default: wantToRead) */}
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          {STATUS_FILTERS.map((s) => {
            const active = statusFilter === s;
            const count = s === "all" ? entries.length : statusCounts[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => handleStatusFilter(s)}
                aria-pressed={active}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  active
                    ? "bg-amber-600 border-amber-600 text-white"
                    : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                }`}
              >
                {s === "all" ? "All" : statusLabel(s)} ({count})
              </button>
            );
          })}
        </div>

        {showAddBook && libraries.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowAddBook(false)} />
            <div
              role="dialog"
              aria-label="Add a book"
              className="relative w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4"
            >
              <div className="mb-3">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">Add a book</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Search Libby for a book to add to your list.
                </p>
              </div>
              <BookSearchPicker
                libraryKey={libraries[0].preferredKey}
                onSelect={handleSelectBook}
                onCancel={() => setShowAddBook(false)}
                placeholder="Search Libby for a book to add..."
                existingBooks={entries.map((e) => ({ title: e.title, author: e.author ?? "" }))}
              />
            </div>
          </div>
        )}

        {entries.length === 0 && (
          <div className="text-center py-12 px-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
            <p className="text-gray-500 dark:text-gray-400">
              No books loaded. Upload a reading list to get started.
            </p>
            <Link
              to="/setup"
              className="text-amber-600 hover:text-amber-700 underline mt-2 inline-block"
            >
              Go to Setup
            </Link>
          </div>
        )}

        {showProgressBar && (
          <ProgressBar
            checked={checkedCount}
            total={totalBooks}
            loading={loadingCount}
            oldestFetchedAt={oldestFetchedAt}
            onRefreshAll={handleRefreshAll}
            enrichmentProgress={enrichmentProgress}
          />
        )}

        {showAvailabilityFilters && wantToReadBooks.length > 0 && checkedCount > 0 && (
          <>
            <SummaryStats
              available={categoryCounts.available}
              soon={categoryCounts.soon}
              waiting={categoryCounts.waiting}
              notFound={categoryCounts.not_found}
              activeCategory={categoryFilter}
              onToggleCategory={handleToggleCategory}
            />
            <FormatFilterBar active={formatFilter} onToggle={handleToggleFormat} />
          </>
        )}

        {/* Search bar — always visible when there are entries */}
        {entries.length > 0 && (
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
              className="w-full pl-10 pr-9 py-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:focus:ring-amber-500 focus:border-transparent"
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

        {sortedAndFilteredEntries.length === 0 && entries.length > 0 && (
          <div className="text-center py-8 px-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {searchQuery.trim()
                ? `No books matching "${searchQuery.trim()}".`
                : "No books match the current filters."}
            </p>
            <button
              onClick={() => {
                setCategoryFilter(null);
                setFormatFilter("all");
                setSearchQuery("");
                handleStatusFilter("wantToRead");
              }}
              className="mt-2 text-amber-600 hover:text-amber-700 underline text-sm"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Toasts */}
        {toasts.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                  t.type === "success"
                    ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                    : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                }`}
              >
                {t.type === "success" ? (
                  <svg
                    className="w-3.5 h-3.5 flex-shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  <svg
                    className="w-3.5 h-3.5 flex-shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                    />
                  </svg>
                )}
                {t.message}
              </div>
            ))}
          </div>
        )}

        <ul className="space-y-3">
          {paginatedEntries.map((entry) => {
            const state = availMap[entry.id] ?? { status: "pending" as const };
            const bookKeyStr = readBookKey({
              workId: entry.workId,
              title: entry.title,
              author: entry.author,
            });
            const authorName = (entry.canonicalAuthor ?? entry.author ?? "").toLowerCase();
            const isCurrentlyEnriching = enrichingIds.has(entry.id);
            return (
              <BookCard
                key={entry.id}
                book={entry}
                state={state}
                libraries={libraries}
                formatFilter={formatFilter}
                onRefresh={
                  showAvailabilityFilters && !entry.__readEntryKey
                    ? () => refreshBook(entry)
                    : undefined
                }
                onLibbyClick={handleLibbyClick}
                onEdit={!isCurrentlyEnriching ? () => setEditing(entry) : undefined}
                onFind={!entry.workId ? () => setFinding(entry) : undefined}
                onRemove={() => handleRemoveEntry(entry)}
                onMarkRead={
                  showAvailabilityFilters && !entry.__readEntryKey
                    ? () => handleMarkRead(entry)
                    : undefined
                }
                onFollowAuthor={authorName ? () => handleFollowAuthor(entry) : undefined}
                onStatusChange={
                  entry.__readEntryKey ? undefined : (s) => handleQuickStatus(entry, s)
                }
                isRead={readBookKeys.has(bookKeyStr)}
                isAuthorFollowed={followedAuthorNames.has(authorName)}
                showAvailability={showAvailabilityFilters}
              />
            );
          })}
        </ul>

        {/* Pagination */}
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
      {editing && (
        <BookEditor
          book={editing}
          onSave={(patch) => handleEditSave(editing, patch)}
          onClose={() => setEditing(null)}
        />
      )}

      {finding && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setFinding(null)} />
          <div
            role="dialog"
            aria-label="Find book match"
            className="relative w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4"
          >
            <div className="mb-3">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                Find match for &ldquo;{finding.title}&rdquo;
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Search and select the correct book to associate metadata.
              </p>
            </div>
            <BookSearchPicker
              libraryKey={libraries[0]?.preferredKey}
              initialQuery={finding.title}
              onSelect={(item) => handleFindSelect(finding, item)}
              onCancel={() => setFinding(null)}
              placeholder="Search by title or author..."
            />
          </div>
        </div>
      )}
    </main>
  );
}
