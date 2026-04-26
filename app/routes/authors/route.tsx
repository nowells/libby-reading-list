import { Link, redirect } from "react-router";
import { useState, useMemo, useRef, useCallback } from "react";
import {
  getAuthors,
  getLibraries,
  getBooks,
  addAuthor,
  removeAuthor,
  addBook,
  addReadBook,
  removeReadBook,
  getReadBooks,
  readBookKey,
  addDismissedWork,
  getDismissedWorks,
  workDismissKey,
  type AuthorEntry,
  type LibraryConfig,
} from "~/lib/storage";
import { Logo } from "~/components/logo";
import { searchAuthor, type AuthorSearchResult } from "~/lib/openlibrary-author";
import type { AuthorBookResult } from "./hooks/use-author-availability";
import { useAuthorAvailability } from "./hooks/use-author-availability";
import {
  AuthorCard,
  categorizeWork,
  bestAuthorCategory,
  CATEGORY_ORDER,
  type AuthorFormatFilter,
  type AuthorCategoryFilter,
} from "./components/author-card";
import { SummaryStats } from "~/routes/books/components/summary-stats";
import { FormatFilterBar } from "~/routes/books/components/format-filter-bar";
import type { BookCategory } from "~/routes/books/lib/categorize";
import type { FormatFilter } from "~/routes/books/lib/categorize";
import { timeAgo } from "~/routes/books/lib/utils";

export function meta() {
  return [{ title: "Authors | ShelfCheck" }];
}

export function clientLoader() {
  const libraries = getLibraries();
  if (libraries.length === 0) {
    throw redirect("/setup");
  }
  return { libraries };
}

/** Simple fuzzy match for author name / work title */
function authorMatchesSearch(query: string, authorName: string, workTitles: string[]): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  if (authorName.toLowerCase().includes(q)) return true;
  return workTitles.some((t) => t.toLowerCase().includes(q));
}

export default function Authors() {
  const [authors, setAuthorsState] = useState<AuthorEntry[]>(() => getAuthors());
  const [libraries] = useState<LibraryConfig[]>(() => getLibraries());
  const [showAddAuthor, setShowAddAuthor] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AuthorSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [readBooks, setReadBooksState] = useState(() => getReadBooks());
  const [dismissedWorks, setDismissedWorksState] = useState(() => getDismissedWorks());

  const readBookKeys = useMemo(() => new Set(readBooks.map((r) => r.key)), [readBooks]);
  const dismissedWorkKeys = useMemo(
    () => new Set(dismissedWorks.map((d) => d.key)),
    [dismissedWorks],
  );

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<BookCategory | null>(null);
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Compute a stable display order for authors so the hook loads visible ones first.
  // This uses a ref so the hook can read the latest order without re-triggering the effect.
  const displayOrderRef = useRef<string[]>(authors.map((a) => a.id));

  const { stateMap, refreshAuthor, refreshAll, checkedCount, loadingCount, oldestFetchedAt } =
    useAuthorAvailability(authors, libraries, { loadOrder: displayOrderRef.current });

  // Check if any author data has loaded
  const anyLoaded = authors.some((a) => {
    const s = stateMap[a.id];
    return s && s.status === "done" && s.works.length > 0;
  });

  // Aggregate availability stats across ALL works from ALL authors (excluding dismissed)
  const categoryCounts = useMemo(() => {
    const counts = { available: 0, soon: 0, waiting: 0, not_found: 0 };
    for (const author of authors) {
      const state = stateMap[author.id];
      if (!state || state.status !== "done") continue;
      const authorName = state.resolvedName ?? author.name;
      for (const work of state.works) {
        const key = workDismissKey({
          olWorkKey: work.olWorkKey,
          title: work.title,
          author: authorName,
        });
        if (dismissedWorkKeys.has(key)) continue;
        const cat = categorizeWork(work, formatFilter as AuthorFormatFilter);
        counts[cat]++;
      }
    }
    return counts;
  }, [authors, stateMap, formatFilter, dismissedWorkKeys]);

  // Filter and sort authors by best availability, then last name
  const filteredAuthors = useMemo(() => {
    const filtered = authors.filter((author) => {
      const state = stateMap[author.id];
      const works = state?.works ?? [];
      const workTitles = works.map((w) => w.title);

      // Search filter
      if (searchQuery.trim() && !authorMatchesSearch(searchQuery, author.name, workTitles)) {
        return false;
      }

      // Category filter: author must have at least one work matching
      if (categoryFilter && state?.status === "done") {
        const hasMatch = works.some(
          (w) => categorizeWork(w, formatFilter as AuthorFormatFilter) === categoryFilter,
        );
        if (!hasMatch) return false;
      }

      return true;
    });

    // Sort by best availability category, then by last name
    return filtered.sort((a, b) => {
      const aState = stateMap[a.id];
      const bState = stateMap[b.id];
      const aCat =
        aState?.status === "done"
          ? CATEGORY_ORDER[bestAuthorCategory(aState.works, formatFilter as AuthorFormatFilter)]
          : 999;
      const bCat =
        bState?.status === "done"
          ? CATEGORY_ORDER[bestAuthorCategory(bState.works, formatFilter as AuthorFormatFilter)]
          : 999;
      if (aCat !== bCat) return aCat - bCat;

      // Sort by last name, then first name
      const aName = a.name.trim().split(/\s+/);
      const bName = b.name.trim().split(/\s+/);
      const aLast = aName[aName.length - 1].toLowerCase();
      const bLast = bName[bName.length - 1].toLowerCase();
      if (aLast !== bLast) return aLast.localeCompare(bLast);
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
  }, [authors, stateMap, categoryFilter, formatFilter, searchQuery]);

  // Keep the load-order ref in sync with the current display order
  displayOrderRef.current = filteredAuthors.map((a) => a.id);

  const handleAddQueryChange = useCallback((value: string) => {
    setAddSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchAuthor(value.trim());
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const handleAddAuthor = (result: AuthorSearchResult) => {
    addAuthor({ name: result.name, olKey: result.key });
    setAuthorsState(getAuthors());
    setAddSearchQuery("");
    setSearchResults([]);
    setShowAddAuthor(false);
  };

  const handleAddCustomAuthor = () => {
    if (!addSearchQuery.trim()) return;
    addAuthor({ name: addSearchQuery.trim() });
    setAuthorsState(getAuthors());
    setAddSearchQuery("");
    setSearchResults([]);
    setShowAddAuthor(false);
  };

  const handleRemoveAuthor = (id: string) => {
    removeAuthor(id);
    setAuthorsState(getAuthors());
  };

  const handleWantToRead = (work: AuthorBookResult, authorName: string) => {
    // Check if already in the books list by title+author
    const existingBooks = getBooks();
    const alreadyExists = existingBooks.some(
      (b) =>
        b.title.toLowerCase() === work.title.toLowerCase() ||
        (b.workId && work.olWorkKey && b.workId === work.olWorkKey),
    );
    if (!alreadyExists) {
      addBook({
        title: work.title,
        author: authorName,
        source: "unknown",
        workId: work.olWorkKey,
        firstPublishYear: work.firstPublishYear,
        imageUrl: work.coverId
          ? `https://covers.openlibrary.org/b/id/${work.coverId}-M.jpg`
          : undefined,
      });
    }
  };

  const handleMarkWorkRead = (work: AuthorBookResult, authorName: string) => {
    const key = readBookKey({ workId: work.olWorkKey, title: work.title, author: authorName });
    if (readBookKeys.has(key)) {
      removeReadBook(key);
    } else {
      addReadBook({ key, title: work.title, author: authorName, workId: work.olWorkKey });
    }
    setReadBooksState(getReadBooks());
  };

  const handleDismissWork = (work: AuthorBookResult, authorName: string) => {
    const key = workDismissKey({
      olWorkKey: work.olWorkKey,
      title: work.title,
      author: authorName,
    });
    addDismissedWork({
      key,
      title: work.title,
      author: authorName,
      workId: work.olWorkKey,
    });
    setDismissedWorksState(getDismissedWorks());
  };

  const isWorkRead = useCallback(
    (work: AuthorBookResult, authorName: string) => {
      const key = readBookKey({ workId: work.olWorkKey, title: work.title, author: authorName });
      return readBookKeys.has(key);
    },
    [readBookKeys],
  );

  const isWorkDismissedFn = useCallback(
    (work: AuthorBookResult, authorName: string) => {
      const key = workDismissKey({
        olWorkKey: work.olWorkKey,
        title: work.title,
        author: authorName,
      });
      return dismissedWorkKeys.has(key);
    },
    [dismissedWorkKeys],
  );

  const handleToggleCategory = (cat: BookCategory) => {
    setCategoryFilter(categoryFilter === cat ? null : cat);
  };

  const handleToggleFormat = (f: FormatFilter) => {
    setFormatFilter(f);
  };

  return (
    <main className="min-h-screen py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <Logo className="w-9 h-9 flex-shrink-0" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex-1 min-w-0 truncate">
              Authors
            </h1>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                onClick={() => setShowAddAuthor((s) => !s)}
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
                to="/books"
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
                    d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                  />
                </svg>
                <span className="hidden sm:inline">Books</span>
              </Link>
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
          <div className="mt-1 sm:ml-12 flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {authors.length} {authors.length === 1 ? "author" : "authors"} &middot;{" "}
              {libraries.length} {libraries.length === 1 ? "library" : "libraries"}
            </span>
            {oldestFetchedAt && checkedCount > 0 && (
              <button
                type="button"
                onClick={refreshAll}
                disabled={loadingCount > 0}
                title="Refresh Libby availability"
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors disabled:opacity-70 whitespace-nowrap"
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
                    ? `Syncing... ${checkedCount}/${authors.length}`
                    : `Synced ${timeAgo(oldestFetchedAt)}`}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Add Author Modal */}
        {showAddAuthor && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => {
                setShowAddAuthor(false);
                setAddSearchQuery("");
                setSearchResults([]);
              }}
            />
            <div
              role="dialog"
              aria-label="Add an author"
              className="relative w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4"
            >
              <div className="mb-3">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">Add an author</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Search for an author to follow and track their books.
                </p>
              </div>
              <div className="space-y-3">
                <div className="relative">
                  <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
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
                    value={addSearchQuery}
                    onChange={(e) => handleAddQueryChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && addSearchQuery.trim() && searchResults.length > 0) {
                        handleAddAuthor(searchResults[0]);
                      }
                    }}
                    placeholder="Search for an author..."
                    className="w-full pl-10 pr-9 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:focus:ring-amber-500 focus:border-transparent"
                    autoFocus
                  />
                  {searching && (
                    <svg
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400"
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
                  )}
                  {!searching && addSearchQuery && (
                    <button
                      onClick={() => handleAddQueryChange("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Search results */}
                {searchResults.length > 0 && (
                  <div className="max-h-64 overflow-y-auto space-y-1 rounded-lg border border-gray-200 dark:border-gray-700">
                    {searchResults.map((result) => (
                      <button
                        key={result.key}
                        onClick={() => handleAddAuthor(result)}
                        className="w-full flex items-center justify-between p-2.5 text-left transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/20"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {result.name}
                          </span>
                          <span className="ml-2 text-xs text-gray-400">
                            {result.workCount} works
                          </span>
                          {result.topWork && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              Notable: {result.topWork}
                            </p>
                          )}
                        </div>
                        <svg
                          className="w-4 h-4 text-gray-400 flex-shrink-0"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 4.5v15m7.5-7.5h-15"
                          />
                        </svg>
                      </button>
                    ))}
                  </div>
                )}

                {/* Option to add as custom name */}
                {addSearchQuery.trim() && searchResults.length > 0 && (
                  <button
                    onClick={handleAddCustomAuthor}
                    className="w-full text-center text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    Or add &quot;{addSearchQuery.trim()}&quot; as-is
                  </button>
                )}
                {addSearchQuery.trim() && !searching && searchResults.length === 0 && (
                  <button
                    onClick={handleAddCustomAuthor}
                    className="w-full text-center text-sm text-purple-600 hover:text-purple-700"
                  >
                    Add &quot;{addSearchQuery.trim()}&quot;
                  </button>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddAuthor(false);
                      setAddSearchQuery("");
                      setSearchResults([]);
                    }}
                    className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {authors.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
            <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-purple-600 dark:text-purple-400"
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
            </div>
            <p className="text-gray-500 dark:text-gray-400 mb-2">No authors added yet.</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
              Follow an author to see all their available books at your library.
            </p>
            <button
              onClick={() => setShowAddAuthor(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
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
              Add an Author
            </button>
          </div>
        )}

        {/* Filters */}
        {authors.length > 0 && anyLoaded && (
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
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by author or book title..."
                className="w-full pl-10 pr-9 py-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-400 dark:focus:ring-purple-500 focus:border-transparent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
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

        {/* No results */}
        {filteredAuthors.length === 0 && authors.length > 0 && (
          <div className="text-center py-8 bg-white dark:bg-gray-800 rounded-xl shadow-sm">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {searchQuery.trim()
                ? `No authors matching "${searchQuery.trim()}".`
                : "No authors match the current filters."}
            </p>
            <button
              onClick={() => {
                setCategoryFilter(null);
                setFormatFilter("all");
                setSearchQuery("");
              }}
              className="mt-2 text-sm text-purple-600 hover:text-purple-700"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Author cards */}
        <div className="space-y-4">
          {filteredAuthors.map((author) => {
            const state = stateMap[author.id] ?? { status: "idle" as const, works: [] };
            const authorName = state.resolvedName ?? author.name;
            return (
              <AuthorCard
                key={author.id}
                author={author}
                state={state}
                libraries={libraries}
                formatFilter={formatFilter as AuthorFormatFilter}
                categoryFilter={categoryFilter as AuthorCategoryFilter}
                searchQuery={searchQuery}
                onRefresh={() => refreshAuthor(author)}
                onRemove={() => handleRemoveAuthor(author.id)}
                onWantToRead={(work) => handleWantToRead(work, authorName)}
                onMarkRead={(work) => handleMarkWorkRead(work, authorName)}
                onDismissWork={(work) => handleDismissWork(work, authorName)}
                isWorkRead={(work) => isWorkRead(work, authorName)}
                isWorkDismissed={(work) => isWorkDismissedFn(work, authorName)}
              />
            );
          })}
        </div>
      </div>
    </main>
  );
}
