import { usePostHog } from "@posthog/react";
import { Link } from "react-router";
import { useState, useEffect, useRef } from "react";
import { importBooks } from "~/lib/csv-parser";
import { Logo } from "~/components/logo";
import {
  getBooks,
  setBooks,
  clearBooks,
  getLibraries,
  addLibrary,
  removeLibrary,
  clearLibraries,
  clearAll,
  type Book,
  type LibraryConfig,
} from "~/lib/storage";
import {
  searchLibraryByName,
  getLibraryPreferredKey,
  type LibbyLibrary,
} from "~/lib/libby";

export default function Setup() {
  const posthog = usePostHog();
  const [books, setBooksState] = useState<Book[]>([]);
  const [libraries, setLibrariesState] = useState<LibraryConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);

  // Library search state
  const [libraryQuery, setLibraryQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LibbyLibrary[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectingLibrary, setSelectingLibrary] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBooksState(getBooks());
    setLibrariesState(getLibraries());
  }, []);

  const booksDone = books.length > 0;
  const libraryDone = libraries.length > 0;
  const allDone = booksDone && libraryDone;

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setImportInfo(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const result = importBooks(text);

      if (result.error) {
        setError(result.error);
        posthog?.capture("csv_upload_failed", {
          error: result.error,
          format: result.format,
          total_rows: result.totalRows,
        });
        return;
      }

      if (result.books.length === 0) {
        const noWantToReadError = `No "want to read" books found in the CSV. Found ${result.totalRows} total rows.`;
        setError(noWantToReadError);
        posthog?.capture("csv_upload_failed", {
          error: noWantToReadError,
          format: result.format,
          total_rows: result.totalRows,
        });
        return;
      }

      setBooks(result.books);
      setBooksState(result.books);
      posthog?.capture("csv_uploaded", {
        format: result.format,
        book_count: result.books.length,
        total_rows: result.totalRows,
      });

      const formatName =
        result.format === "goodreads"
          ? "Goodreads"
          : result.format === "hardcover"
            ? "Hardcover"
            : "CSV";
      setImportInfo(
        `Imported ${result.books.length} want-to-read books from ${formatName} (${result.totalRows} total rows in file).`
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.onerror = () => setError("Failed to read file.");
    reader.readAsText(file);
  }

  function handleClearBooks() {
    clearBooks();
    setBooksState([]);
    setImportInfo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleLibrarySearch(e: React.FormEvent) {
    e.preventDefault();
    if (libraryQuery.length < 2) return;
    setSearching(true);
    setError(null);
    setHasSearched(true);
    try {
      const results = await searchLibraryByName(libraryQuery);
      // Filter out already-added libraries
      const existingKeys = new Set(libraries.map((l) => l.key));
      const filtered = results.filter((r) => !existingKeys.has(r.fulfillmentId));
      setSearchResults(filtered);
      posthog?.capture("library_searched", {
        query: libraryQuery,
        result_count: filtered.length,
      });
    } catch {
      setError("Failed to search libraries. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  async function handleSelectLibrary(lib: LibbyLibrary) {
    setSelectingLibrary(true);
    setError(null);
    try {
      let preferredKey = lib.fulfillmentId;
      try {
        preferredKey = await getLibraryPreferredKey(lib.fulfillmentId);
      } catch {
        // Fall back to fulfillmentId
      }
      const config: LibraryConfig = {
        key: lib.fulfillmentId,
        preferredKey,
        name: lib.name,
        logoUrl: lib.logoUrl,
      };
      addLibrary(config);
      setLibrariesState(getLibraries());
      setSearchResults((prev) => prev.filter((r) => r.fulfillmentId !== lib.fulfillmentId));
      posthog?.capture("library_added", {
        library_name: lib.name,
        library_key: lib.fulfillmentId,
        library_type: lib.type,
      });
    } catch {
      setError("Failed to add library. Please try again.");
    } finally {
      setSelectingLibrary(false);
    }
  }

  function handleRemoveLibrary(key: string) {
    const lib = libraries.find((l) => l.key === key);
    removeLibrary(key);
    setLibrariesState(getLibraries());
    posthog?.capture("library_removed", {
      library_name: lib?.name,
      library_key: key,
    });
  }

  function handleClearAll() {
    posthog?.capture("setup_reset", {
      book_count: books.length,
      library_count: libraries.length,
    });
    clearAll();
    setBooksState([]);
    setLibrariesState([]);
    setImportInfo(null);
    setSearchResults([]);
    setHasSearched(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-950 dark:to-gray-900 py-12 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Logo className="w-10 h-10" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            ShelfCheck Setup
          </h1>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {importInfo && (
          <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4 text-green-700 dark:text-green-400">
            {importInfo}
          </div>
        )}

        {/* Step 1: Upload Reading List */}
        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${booksDone ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"}`}
            >
              {booksDone ? "\u2713" : "1"}
            </span>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Upload Reading List
            </h2>
          </div>

          {booksDone && (
            <div className="flex items-center justify-between mb-4">
              <p className="text-green-600 dark:text-green-400">
                {books.length} books loaded
                {books[0]?.source !== "unknown" && (
                  <span className="text-gray-500 dark:text-gray-400">
                    {" "}
                    from{" "}
                    {books[0].source === "goodreads"
                      ? "Goodreads"
                      : "Hardcover"}
                  </span>
                )}
              </p>
              <button
                onClick={handleClearBooks}
                className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline"
              >
                Clear
              </button>
            </div>
          )}

          <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
            {booksDone
              ? "Upload a new CSV to replace your current list."
              : "Upload a CSV export of your reading list. We'll find the \"want to read\" books."}
          </p>
          <div className="space-y-3">
            {!booksDone && (
              <>
                <details className="text-sm text-gray-500 dark:text-gray-400">
                  <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                    How to export from Goodreads
                  </summary>
                  <ol className="list-decimal list-inside mt-2 space-y-1 pl-2">
                    <li>
                      Go to{" "}
                      <a
                        href="https://www.goodreads.com/review/import"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-600 hover:text-amber-700 underline"
                      >
                        goodreads.com/review/import
                      </a>
                    </li>
                    <li>Click "Export Library" at the top</li>
                    <li>Wait for the export to complete, then download the CSV</li>
                  </ol>
                </details>
                <details className="text-sm text-gray-500 dark:text-gray-400">
                  <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                    How to export from Hardcover
                  </summary>
                  <ol className="list-decimal list-inside mt-2 space-y-1 pl-2">
                    <li>
                      Go to{" "}
                      <a
                        href="https://hardcover.app/account/exports"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-600 hover:text-amber-700 underline"
                      >
                        hardcover.app/account/exports
                      </a>
                    </li>
                    <li>Click "Export" to generate a CSV</li>
                    <li>Download the file when ready</li>
                  </ol>
                </details>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileUpload}
              className="block w-full text-sm text-gray-500 dark:text-gray-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-lg file:border-0
                file:text-sm file:font-medium
                file:bg-amber-50 file:text-amber-700
                hover:file:bg-amber-100
                dark:file:bg-amber-900/30 dark:file:text-amber-300
                dark:hover:file:bg-amber-900/50
                cursor-pointer"
            />
          </div>
        </section>

        {/* Step 2: Library Selection */}
        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${libraryDone ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"}`}
            >
              {libraryDone ? "\u2713" : "2"}
            </span>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Libby {libraries.length === 1 ? "Library" : "Libraries"}
            </h2>
          </div>

          {/* Show added libraries */}
          {libraries.length > 0 && (
            <div className="space-y-2 mb-4">
              {libraries.map((lib) => (
                <div
                  key={lib.key}
                  className="flex items-center justify-between p-3 border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    {lib.logoUrl ? (
                      <img src={lib.logoUrl} alt="" className="h-5 w-auto rounded bg-white p-0.5 flex-shrink-0" />
                    ) : (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-green-200 dark:bg-green-800 text-[10px] font-bold text-green-700 dark:text-green-300 flex-shrink-0">
                        {lib.name[0]?.toUpperCase()}
                      </span>
                    )}
                    <span className="font-medium text-gray-900 dark:text-white">
                      {lib.name}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveLibrary(lib.key)}
                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
            {libraries.length > 0
              ? "Add another library to search across multiple systems."
              : "Search for your local library to check availability through Libby."}
          </p>
          <form onSubmit={handleLibrarySearch} className="mb-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={libraryQuery}
                onChange={(e) => setLibraryQuery(e.target.value)}
                placeholder="Search for a library..."
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
              />
              <button
                type="submit"
                disabled={searching || libraryQuery.length < 2}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
              >
                {searching ? "Searching..." : "Search"}
              </button>
            </div>
          </form>

          {searchResults.length > 0 && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {searchResults.map((lib) => (
                <button
                  key={lib.id}
                  onClick={() => handleSelectLibrary(lib)}
                  disabled={selectingLibrary}
                  className="w-full text-left p-3 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {lib.logoUrl ? (
                    <img src={lib.logoUrl} alt="" className="h-5 w-auto rounded bg-white p-0.5 flex-shrink-0" />
                  ) : (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-gray-200 dark:bg-gray-600 text-[10px] font-bold text-gray-600 dark:text-gray-300 flex-shrink-0">
                      {lib.name[0]?.toUpperCase()}
                    </span>
                  )}
                  <span className="font-medium text-gray-900 dark:text-white">
                    {lib.name}
                  </span>
                  {lib.type && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {lib.type}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {hasSearched &&
            !searching &&
            searchResults.length === 0 && (
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                No additional libraries found. Try a different search term.
              </p>
            )}
        </section>

        {/* Actions */}
        <div className="flex gap-3">
          {allDone && (
            <Link
              to="/books"
              className="flex-1 text-center px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors"
            >
              View Available Books
            </Link>
          )}
          {(booksDone || libraryDone) && (
            <button
              onClick={handleClearAll}
              className="px-4 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Reset All
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
