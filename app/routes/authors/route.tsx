import { Link, redirect } from "react-router";
import { useState } from "react";
import {
  getAuthors,
  getLibraries,
  addAuthor,
  removeAuthor,
  type AuthorEntry,
  type LibraryConfig,
} from "~/lib/storage";
import { Logo } from "~/components/logo";
import { searchAuthor, type AuthorSearchResult } from "~/lib/openlibrary-author";
import { useAuthorAvailability } from "./hooks/use-author-availability";
import { AuthorCard } from "./components/author-card";

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

export default function Authors() {
  const [authors, setAuthorsState] = useState<AuthorEntry[]>(() => getAuthors());
  const [libraries] = useState<LibraryConfig[]>(() => getLibraries());
  const [showAddAuthor, setShowAddAuthor] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AuthorSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const { stateMap, refreshAuthor } = useAuthorAvailability(authors, libraries);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await searchAuthor(searchQuery.trim());
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleAddAuthor = (result: AuthorSearchResult) => {
    addAuthor({ name: result.name, olKey: result.key });
    setAuthorsState(getAuthors());
    setSearchQuery("");
    setSearchResults([]);
    setShowAddAuthor(false);
  };

  const handleAddCustomAuthor = () => {
    if (!searchQuery.trim()) return;
    addAuthor({ name: searchQuery.trim() });
    setAuthorsState(getAuthors());
    setSearchQuery("");
    setSearchResults([]);
    setShowAddAuthor(false);
  };

  const handleRemoveAuthor = (id: string) => {
    removeAuthor(id);
    setAuthorsState(getAuthors());
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-950 dark:to-gray-900 py-8 px-4">
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
                <span className="hidden sm:inline">Add</span>
              </button>
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
          <p className="mt-1 sm:ml-12 text-sm text-gray-500 dark:text-gray-400">
            {authors.length} {authors.length === 1 ? "author" : "authors"} &middot;{" "}
            {libraries.length} {libraries.length === 1 ? "library" : "libraries"}
          </p>
        </div>

        {/* Add Author */}
        {showAddAuthor && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
                placeholder="Search for an author..."
                className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                autoFocus
              />
              <button
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {searching ? "..." : "Search"}
              </button>
              <button
                onClick={() => {
                  setShowAddAuthor(false);
                  setSearchQuery("");
                  setSearchResults([]);
                }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Cancel
              </button>
            </div>

            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="mt-3 space-y-1">
                {searchResults.map((result) => (
                  <button
                    key={result.key}
                    onClick={() => handleAddAuthor(result)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {result.name}
                      </span>
                      <span className="ml-2 text-xs text-gray-400">
                        {result.workCount} works
                      </span>
                      {result.topWork && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Notable: {result.topWork}
                        </p>
                      )}
                    </div>
                    <svg
                      className="w-4 h-4 text-gray-400"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                  </button>
                ))}
              </div>
            )}

            {/* Option to add as custom name */}
            {searchQuery.trim() && searchResults.length > 0 && (
              <button
                onClick={handleAddCustomAuthor}
                className="mt-2 w-full text-center text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                Or add &quot;{searchQuery.trim()}&quot; as-is
              </button>
            )}
            {searchQuery.trim() && !searching && searchResults.length === 0 && (
              <button
                onClick={handleAddCustomAuthor}
                className="mt-3 w-full text-center text-sm text-purple-600 hover:text-purple-700"
              >
                Add &quot;{searchQuery.trim()}&quot;
              </button>
            )}
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

        {/* Author cards */}
        <div className="space-y-4">
          {authors.map((author) => {
            const state = stateMap[author.id] ?? { status: "idle" as const, works: [] };
            return (
              <AuthorCard
                key={author.id}
                author={author}
                state={state}
                libraries={libraries}
                onRefresh={() => refreshAuthor(author)}
                onRemove={() => handleRemoveAuthor(author.id)}
              />
            );
          })}
        </div>
      </div>
    </main>
  );
}
