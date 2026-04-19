import { usePostHog } from "@posthog/react";
import { Link, redirect, useSearchParams } from "react-router";
import { useState, useEffect, useMemo } from "react";
import {
  getBooks,
  getLibraries,
  addBook,
  removeBook,
  type Book,
  type LibraryConfig,
} from "~/lib/storage";
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

export function meta() {
  return [{ title: "Your Books | ShelfCheck" }];
}

export function clientLoader() {
  const books = getBooks();
  const libraries = getLibraries();
  if (books.length === 0 || libraries.length === 0) {
    throw redirect("/setup");
  }
  return { books, libraries };
}

export default function Books() {
  const posthog = usePostHog();
  const [books, setBooksState] = useState<Book[]>(() => getBooks());
  const [libraries] = useState<LibraryConfig[]>(() => getLibraries());
  const [showAddBook, setShowAddBook] = useState(false);

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

  const {
    availMap,
    checkedCount,
    loadingCount,
    totalBooks,
    refreshBook,
    refreshAll,
    oldestFetchedAt,
  } = useAvailabilityChecker(books, libraries);

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
    setBooksState(getBooks());
    setShowAddBook(false);
    posthog?.capture("book_added_from_search", { title: item.title });
  };

  const handleRemoveBook = (id: string) => {
    removeBook(id);
    setBooksState(getBooks());
    posthog?.capture("book_removed", { book_id: id });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-950 dark:to-gray-900 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Logo className="w-9 h-9" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">ShelfCheck</h1>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                  <span>
                    {books.length} books &middot; {libraries.length}{" "}
                    {libraries.length === 1 ? "library" : "libraries"}
                  </span>
                  <BookhiveSyncStatus onBooksChanged={() => setBooksState(getBooks())} />
                  {oldestFetchedAt && checkedCount > 0 && (
                    <button
                      type="button"
                      onClick={handleRefreshAll}
                      disabled={loadingCount > 0}
                      title="Refresh Libby availability"
                      className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-70"
                    >
                      <svg
                        className={`w-3 h-3 ${loadingCount > 0 ? "animate-spin" : ""}`}
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
                        {loadingCount > 0
                          ? `Syncing Libby... ${checkedCount}/${totalBooks}`
                          : `Synced from Libby ${timeAgo(oldestFetchedAt)}`}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowAddBook((s) => !s)}
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add
              </button>
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
                Settings
              </Link>
            </div>
          </div>
        </div>

        {showAddBook && libraries.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-4">
            <BookSearchPicker
              libraryKey={libraries[0].preferredKey}
              onSelect={handleSelectBook}
              onCancel={() => setShowAddBook(false)}
              placeholder="Search Libby for a book to add..."
              existingBooks={books}
            />
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

        {books.length > 0 && checkedCount < totalBooks && (
          <ProgressBar
            checked={checkedCount}
            total={totalBooks}
            loading={loadingCount}
            oldestFetchedAt={oldestFetchedAt}
            onRefreshAll={handleRefreshAll}
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

        <div className="space-y-3">
          {paginatedBooks.map((book) => {
            const state = availMap[book.id] ?? { status: "pending" as const };
            return (
              <BookCard
                key={book.id}
                book={book}
                state={state}
                libraries={libraries}
                formatFilter={formatFilter}
                onRefresh={() => refreshBook(book)}
                onLibbyClick={handleLibbyClick}
                onRemove={book.manual ? () => handleRemoveBook(book.id) : undefined}
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
    </main>
  );
}
