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
} from "~/lib/storage";
import { enrichBooksWithWorkId } from "~/lib/openlibrary";
import { getAuthor } from "~/components/book-search-utils";
import { Logo } from "~/components/logo";
import { BookSearchPicker } from "~/components/book-search-picker";
import type { LibbyMediaItem } from "~/lib/libby";
import { useAvailabilityChecker } from "./hooks/use-availability-checker";
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

export function meta() {
  return [{ title: "Your Books | ShelfCheck" }];
}

export function clientLoader() {
  const books = getBooks().filter(isWantToRead);
  const libraries = getLibraries();
  if (books.length === 0 || libraries.length === 0) {
    throw redirect("/setup");
  }
  return { books, libraries };
}

export default function Books() {
  const posthog = usePostHog();
  const [books, setBooksState] = useState<Book[]>(() => getBooks().filter(isWantToRead));
  const [libraries] = useState<LibraryConfig[]>(() => getLibraries());
  const [showAddBook, setShowAddBook] = useState(false);
  const [readBooks, setReadBooks] = useState(() => getReadBooks());
  const [followedAuthors, setFollowedAuthors] = useState(() => getAuthors());
  const [editing, setEditing] = useState<Book | null>(null);
  const [finding, setFinding] = useState<Book | null>(null);
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<
    { id: number; message: string; type: "success" | "error" }[]
  >([]);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  const readBookKeys = useMemo(() => new Set(readBooks.map((r) => r.key)), [readBooks]);
  const followedAuthorNames = useMemo(
    () => new Set(followedAuthors.map((a) => a.name.toLowerCase())),
    [followedAuthors],
  );

  useEffect(() => {
    posthog?.capture("books_page_viewed", {
      book_count: books.length,
      library_count: libraries.length,
      book_source: books[0]?.source,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<BookCategory | null>(null);
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const handleBookEnriched = useCallback((bookId: string, updates: Partial<Book>) => {
    setBooksState((prev) => prev.map((b) => (b.id === bookId ? { ...b, ...updates } : b)));
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
  } = useAvailabilityChecker(books, libraries, { onBookEnriched: handleBookEnriched });

  const categoryCounts = useMemo(() => {
    const counts = { available: 0, soon: 0, waiting: 0, not_found: 0 };
    for (const book of books) {
      const cat = categorizeBookWithFormat(availMap[book.id], formatFilter);
      if (cat !== "pending" && cat in counts) {
        counts[cat as keyof typeof counts]++;
      }
    }
    return counts;
  }, [books, availMap, formatFilter]);

  const sortedAndFilteredBooks = useMemo(() => {
    let filtered = [...books];

    // Apply search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter((b) => fuzzyMatch(searchQuery, b.title, b.author));
    }

    // Apply category filter
    if (categoryFilter) {
      filtered = filtered.filter(
        (b) => categorizeBookWithFormat(availMap[b.id], formatFilter) === categoryFilter,
      );
    }

    // Sort by category score then title
    filtered.sort((a, b) => {
      const scoreA = categoryScore(categorizeBookWithFormat(availMap[a.id], formatFilter));
      const scoreB = categoryScore(categorizeBookWithFormat(availMap[b.id], formatFilter));
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.title.localeCompare(b.title);
    });

    return filtered;
  }, [books, availMap, categoryFilter, formatFilter, searchQuery]);

  const totalPages = Math.ceil(sortedAndFilteredBooks.length / PAGE_SIZE);
  const paginatedBooks = sortedAndFilteredBooks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const goToPage = (p: number) => {
    setSearchParams({ page: String(p) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setSearchParams({ page: "1" });
  };

  const handleToggleCategory = (cat: BookCategory) => {
    const newFilter = categoryFilter === cat ? null : cat;
    setCategoryFilter(newFilter);
    setSearchParams({ page: "1" });
    posthog?.capture("category_filter_toggled", {
      category: cat,
      active: newFilter === cat,
    });
  };

  const handleToggleFormat = (f: FormatFilter) => {
    setFormatFilter(f);
    setSearchParams({ page: "1" });
    posthog?.capture("format_filter_toggled", { format: f });
  };

  const handleRefreshAll = () => {
    posthog?.capture("all_books_refreshed", {
      book_count: books.length,
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
    const author = item.creators?.find((c) => c.role === "Author")?.name ?? "";
    addBook({
      title: item.title,
      author,
      imageUrl: item.covers?.cover150Wide?.href,
      source: "unknown",
    });
    setBooksState(getBooks().filter(isWantToRead));
    setShowAddBook(false);
    posthog?.capture("book_added_from_search", { title: item.title });
  };

  const handleRemoveBook = (id: string) => {
    removeBook(id);
    setBooksState(getBooks().filter(isWantToRead));
    posthog?.capture("book_removed", { book_id: id });
  };

  const handleMarkRead = (book: Book) => {
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

  const handleEditSave = (patch: BookEditorPatch) => {
    if (!editing) return;
    updateBook(editing.id, patch);
    setEditing(null);
    setBooksState(getBooks().filter(isWantToRead));
    posthog?.capture("book_edited", {
      book_id: editing.id,
      status: patch.status,
      has_rating: patch.rating !== undefined,
    });
  };

  const handleFindSelect = (book: Book, item: LibbyMediaItem) => {
    const author = getAuthor(item);
    const imageUrl = item.covers?.cover150Wide?.href;
    updateBook(book.id, {
      title: item.title,
      author,
      ...(imageUrl ? { imageUrl } : {}),
      source: book.source,
    });

    setFinding(null);
    setEnrichingIds((prev) => new Set(prev).add(book.id));
    setBooksState(getBooks().filter(isWantToRead));
    posthog?.capture("book_find_selected", { book_id: book.id, selected_title: item.title });

    const updated = { ...book, title: item.title, author };
    enrichBooksWithWorkId([updated])
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
          updateBook(book.id, {
            workId,
            isbn13,
            imageUrl: enriched[0].imageUrl ?? imageUrl,
            canonicalTitle,
            canonicalAuthor,
            subjects,
            pageCount,
            firstPublishYear,
          });
          setBooksState(getBooks().filter(isWantToRead));
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
          next.delete(book.id);
          return next;
        });
      });
  };

  const handleFollowAuthor = (book: Book) => {
    const authorName = book.canonicalAuthor ?? book.author;
    if (!authorName) return;
    addAuthor({ name: authorName });
    setFollowedAuthors(getAuthors());
    posthog?.capture("author_followed_from_book", { author: authorName, book_id: book.id });
  };

  return (
    <main className="min-h-screen py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <Logo className="w-9 h-9 flex-shrink-0" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex-1 min-w-0 truncate">
              ShelfCheck
            </h1>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                onClick={() => setShowAddBook((s) => !s)}
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
                <span className="hidden sm:inline">Add</span>
              </button>
              <span className="w-px h-4 bg-gray-300 dark:bg-gray-600" />
              <Link
                to="/shelf"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 19.5h16.5M4.5 6.75h15M5.25 4.5v15M18.75 4.5v15M9 4.5v15M15 4.5v15"
                  />
                </svg>
                <span className="hidden sm:inline">Shelf</span>
              </Link>
              <Link
                to="/authors"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg
                  className="w-4 h-4"
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
                <span className="hidden sm:inline">Authors</span>
              </Link>
              <Link
                to="/friends"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
                  />
                </svg>
                <span className="hidden sm:inline">Friends</span>
              </Link>
              <Link
                to="/stats"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
                  />
                </svg>
                <span className="hidden sm:inline">Stats</span>
              </Link>
              <Link
                to="/setup"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                <span className="hidden sm:inline">Settings</span>
              </Link>
            </div>
          </div>
          <div className="mt-1 sm:ml-12">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {books.length} books &middot; {libraries.length}{" "}
              {libraries.length === 1 ? "library" : "libraries"}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <BookhiveSyncStatus
                onBooksChanged={() => setBooksState(getBooks().filter(isWantToRead))}
              />
              {oldestFetchedAt && checkedCount > 0 && (
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
                existingBooks={books}
              />
            </div>
          </div>
        )}

        {books.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
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

        {books.length > 0 && (checkedCount < totalBooks || enrichmentProgress) && (
          <ProgressBar
            checked={checkedCount}
            total={totalBooks}
            loading={loadingCount}
            oldestFetchedAt={oldestFetchedAt}
            onRefreshAll={handleRefreshAll}
            enrichmentProgress={enrichmentProgress}
          />
        )}

        {books.length > 0 && checkedCount > 0 && (
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
                placeholder="Filter your books by title or author..."
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
          </>
        )}

        {sortedAndFilteredBooks.length === 0 && books.length > 0 && checkedCount > 0 && (
          <div className="text-center py-8 bg-white dark:bg-gray-800 rounded-xl shadow-sm">
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

        <div className="space-y-3">
          {paginatedBooks.map((book) => {
            const state = availMap[book.id] ?? { status: "pending" as const };
            const bookKey = readBookKey({
              workId: book.workId,
              title: book.title,
              author: book.author,
            });
            const authorName = (book.canonicalAuthor ?? book.author ?? "").toLowerCase();
            return (
              <BookCard
                key={book.id}
                book={book}
                state={state}
                libraries={libraries}
                formatFilter={formatFilter}
                onRefresh={() => refreshBook(book)}
                onLibbyClick={handleLibbyClick}
                onEdit={() => setEditing(book)}
                onFind={!book.workId ? () => setFinding(book) : undefined}
                onRemove={() => handleRemoveBook(book.id)}
                onMarkRead={() => handleMarkRead(book)}
                onFollowAuthor={authorName ? () => handleFollowAuthor(book) : undefined}
                isRead={readBookKeys.has(bookKey)}
                isAuthorFollowed={followedAuthorNames.has(authorName)}
              />
            );
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-8">
            <button
              onClick={() => goToPage(1)}
              disabled={page <= 1}
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
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
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
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
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
              disabled={page >= totalPages}
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
        <BookEditor book={editing} onSave={handleEditSave} onClose={() => setEditing(null)} />
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
