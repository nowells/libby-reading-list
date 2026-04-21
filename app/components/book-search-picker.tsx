import { useState, useRef, useEffect, useMemo } from "react";
import { searchLibrary, REFERENCE_LIBRARY, type LibbyMediaItem } from "~/lib/libby";

function getAuthor(item: LibbyMediaItem): string {
  return item.creators?.find((c) => c.role === "Author")?.name ?? "";
}

/** Normalize a string for dedup comparison: lowercase, strip all non-alphanumeric chars */
function normalizeForDedup(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Deduplicate items by normalized sortTitle+creator, preferring items with cover art */
function deduplicateItems(items: LibbyMediaItem[]): LibbyMediaItem[] {
  const seen = new Map<string, LibbyMediaItem>();
  for (const item of items) {
    const creator = item.firstCreatorSortName ?? getAuthor(item);
    const key = `${normalizeForDedup(item.sortTitle)}\0${normalizeForDedup(creator)}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
    } else if (!existing.covers?.cover150Wide?.href && item.covers?.cover150Wide?.href) {
      seen.set(key, item);
    }
  }
  return [...seen.values()];
}

interface ExistingBook {
  title: string;
  author: string;
}

interface BookSearchPickerProps {
  libraryKey?: string;
  onSelect: (item: LibbyMediaItem) => void;
  onCancel?: () => void;
  placeholder?: string;
  /** Pre-fill the search box and trigger an initial search on mount. */
  initialQuery?: string;
  existingBooks?: ExistingBook[];
}

export function BookSearchPicker({
  libraryKey,
  onSelect,
  onCancel,
  placeholder = "Search for a book...",
  initialQuery,
  existingBooks = [],
}: BookSearchPickerProps) {
  const existingSet = useMemo(() => {
    const set = new Set<string>();
    for (const b of existingBooks) {
      set.add(`${normalizeForDedup(b.title)}\0${normalizeForDedup(b.author)}`);
    }
    return set;
  }, [existingBooks]);

  function isInLibrary(item: LibbyMediaItem): boolean {
    const title = normalizeForDedup(item.title);
    const author = normalizeForDedup(getAuthor(item));
    return existingSet.has(`${title}\0${author}`);
  }

  const [query, setQuery] = useState(initialQuery ?? "");
  const [results, setResults] = useState<LibbyMediaItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const didInitialSearch = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    // Auto-search on mount if initialQuery is provided
    if (initialQuery && initialQuery.trim().length >= 2 && !didInitialSearch.current) {
      didInitialSearch.current = true;
      handleQueryChange(initialQuery);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const items = await searchLibrary(libraryKey ?? REFERENCE_LIBRARY, value.trim());
        setResults(deduplicateItems(items).slice(0, 10));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
        setHasSearched(true);
      }
    }, 400);
  }

  return (
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
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-9 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:focus:ring-amber-500 focus:border-transparent"
        />
        {searching ? (
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
        ) : (
          query && (
            <button
              onClick={() => handleQueryChange("")}
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
          )
        )}
      </div>

      {results.length > 0 && (
        <div className="max-h-64 overflow-y-auto space-y-1 rounded-lg border border-gray-200 dark:border-gray-700">
          {results.map((item) => {
            const alreadyAdded = isInLibrary(item);
            return (
              <button
                key={item.id}
                onClick={() => !alreadyAdded && onSelect(item)}
                disabled={alreadyAdded}
                className={`w-full text-left p-2.5 transition-colors flex items-start gap-3 ${alreadyAdded ? "opacity-50 cursor-default" : "hover:bg-amber-50 dark:hover:bg-amber-900/20"}`}
              >
                {item.covers?.cover150Wide?.href ? (
                  <img
                    src={item.covers.cover150Wide.href}
                    alt=""
                    className="w-10 h-14 object-cover rounded flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-14 bg-gray-200 dark:bg-gray-600 rounded flex-shrink-0 flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-gray-400"
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
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {item.title}
                  </p>
                  {getAuthor(item) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {getAuthor(item)}
                    </p>
                  )}
                </div>
                {alreadyAdded ? (
                  <svg
                    className="w-4 h-4 text-green-500 flex-shrink-0 mt-1"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}

      {hasSearched && !searching && results.length === 0 && query.trim().length >= 2 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
          No books found. Try a different search.
        </p>
      )}

      {onCancel && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
