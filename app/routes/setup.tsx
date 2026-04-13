import { Link } from "react-router";
import { useState, useEffect, useRef } from "react";
import { importBooks } from "~/lib/csv-parser";
import {
  getBooks,
  setBooks,
  clearBooks,
  getLibrary,
  setLibrary,
  clearLibrary,
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
  const [books, setBooksState] = useState<Book[]>([]);
  const [library, setLibraryState] = useState<LibraryConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);

  // Library search state
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraries, setLibraries] = useState<LibbyLibrary[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectingLibrary, setSelectingLibrary] = useState(false);

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBooksState(getBooks());
    setLibraryState(getLibrary());
  }, []);

  const booksDone = books.length > 0;
  const libraryDone = !!library;
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
        return;
      }

      if (result.books.length === 0) {
        setError(
          `No "want to read" books found in the CSV. Found ${result.totalRows} total rows.`
        );
        return;
      }

      setBooks(result.books);
      setBooksState(result.books);

      const formatName =
        result.format === "goodreads"
          ? "Goodreads"
          : result.format === "hardcover"
            ? "Hardcover"
            : "CSV";
      setImportInfo(
        `Imported ${result.books.length} want-to-read books from ${formatName} (${result.totalRows} total rows in file).`
      );
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
    try {
      const results = await searchLibraryByName(libraryQuery);
      setLibraries(results);
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
      };
      setLibrary(config);
      setLibraryState(config);
      setLibraries([]);
    } catch {
      setError("Failed to select library. Please try again.");
    } finally {
      setSelectingLibrary(false);
    }
  }

  function handleClearLibrary() {
    clearLibrary();
    setLibraryState(null);
  }

  function handleClearAll() {
    clearAll();
    setBooksState([]);
    setLibraryState(null);
    setImportInfo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-950 dark:to-gray-900 py-12 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Setup
        </h1>

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

          {booksDone ? (
            <div className="flex items-center justify-between">
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
                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
                Upload a CSV export of your reading list. We'll find the "want
                to read" books.
              </p>
              <div className="space-y-3">
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
            </>
          )}
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
              Libby Library
            </h2>
          </div>

          {libraryDone ? (
            <div className="flex items-center justify-between">
              <p className="text-green-600 dark:text-green-400">
                Connected to{" "}
                <span className="font-medium">
                  {library.name || library.key}
                </span>
              </p>
              <button
                onClick={handleClearLibrary}
                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
                Search for your local library to check availability through
                Libby.
              </p>
              <form onSubmit={handleLibrarySearch} className="mb-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={libraryQuery}
                    onChange={(e) => setLibraryQuery(e.target.value)}
                    placeholder="Search for your library..."
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

              {libraries.length > 0 && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {libraries.map((lib) => (
                    <button
                      key={lib.id}
                      onClick={() => handleSelectLibrary(lib)}
                      disabled={selectingLibrary}
                      className="w-full text-left p-3 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">
                        {lib.name}
                      </span>
                      {lib.type && (
                        <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                          {lib.type}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {libraryQuery.length >= 2 &&
                !searching &&
                libraries.length === 0 && (
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    No libraries found. Try a different search term.
                  </p>
                )}
            </>
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
              Reset
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
