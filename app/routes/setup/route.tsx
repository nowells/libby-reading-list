import { usePostHog } from "@posthog/react";
import { Link } from "react-router";
import { useState, useEffect, useRef } from "react";
import { importBooks } from "~/lib/csv-parser";
import { enrichBooksWithWorkId } from "~/lib/openlibrary";
import { Logo } from "~/components/logo";
import {
  getBooks,
  setImportedBooks,
  addBook,
  clearBooks,
  getLibraries,
  addLibrary,
  removeLibrary,
  clearLibraries,
  clearAll,
  getBookhiveLastSync,
  clearBookhiveLastSync,
  type Book,
  type LibraryConfig,
} from "~/lib/storage";
import {
  searchLibraryByName,
  getLibraryPreferredKey,
  type LibbyLibrary,
  type LibbyMediaItem,
} from "~/lib/libby";
import { BookSearchPicker } from "~/components/book-search-picker";
import {
  initSession,
  signInWithBluesky,
  signOut,
  syncBookhive,
  isBookhiveSyncStale,
  searchHandleSuggestions,
  type AtprotoSessionInfo,
  type HandleSuggestion,
} from "~/lib/atproto";
import type { OAuthSession } from "@atproto/oauth-client-browser";

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "just now";
  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return relativeTimeFormatter.format(diffSeconds, "second");
  if (abs < 3600) return relativeTimeFormatter.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return relativeTimeFormatter.format(Math.round(diffSeconds / 3600), "hour");
  return relativeTimeFormatter.format(Math.round(diffSeconds / 86400), "day");
}

export default function Setup() {
  const posthog = usePostHog();
  const [books, setBooksState] = useState<Book[]>([]);
  const [libraries, setLibrariesState] = useState<LibraryConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);

  const [clearManualOnImport, setClearManualOnImport] = useState(false);
  const manualBookCount = books.filter((b) => b.manual).length;

  // Library search state
  const [libraryQuery, setLibraryQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LibbyLibrary[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectingLibrary, setSelectingLibrary] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Bluesky / ATProto state
  const [bskySession, setBskySession] = useState<OAuthSession | null>(null);
  const [bskyInfo, setBskyInfo] = useState<AtprotoSessionInfo | null>(null);
  const [bskyInitializing, setBskyInitializing] = useState(true);
  const [bskyHandle, setBskyHandle] = useState("");
  const [bskyImporting, setBskyImporting] = useState(false);
  const [bskyLastSync, setBskyLastSync] = useState<string | null>(null);
  const [bskySuggestions, setBskySuggestions] = useState<HandleSuggestion[]>([]);
  const [bskySuggestionsOpen, setBskySuggestionsOpen] = useState(false);

  // Step 1 collapses once books are loaded so step 2 becomes the focus.
  // Tracks whether the user has manually forced it open after that.
  const [step1ForceOpen, setStep1ForceOpen] = useState(false);
  const bskyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bskyAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setBooksState(getBooks());
    setLibrariesState(getLibraries());
    setBskyLastSync(getBookhiveLastSync());
  }, []);

  useEffect(() => {
    let cancelled = false;
    initSession()
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setBskySession(result.session);
          setBskyInfo(result.info);
          // Auto-import on fresh sign-in, and on restored sessions whose
          // last sync is missing or older than the TTL (daily cadence).
          if (result.fresh || isBookhiveSyncStale()) {
            void runBskyImport(result.session, { silent: true });
          }
        }
      })
      .catch(() => {
        // Non-fatal: user can still use CSV flow.
      })
      .finally(() => {
        if (!cancelled) setBskyInitializing(false);
      });
    return () => {
      cancelled = true;
    };
    // runBskyImport is stable via function declaration; deps intentionally empty for one-shot init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const booksDone = books.length > 0;
  const libraryDone = libraries.length > 0;
  const allDone = booksDone && libraryDone;
  const step1Collapsed = booksDone && !step1ForceOpen;

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setImportInfo(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
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

      const enriched = await enrichBooksWithWorkId(result.books);
      // All books in a CSV batch share the same source (set by csv-parser);
      // pass it explicitly so we only replace prior books from this source.
      const csvSource = enriched[0]?.source ?? "unknown";
      setImportedBooks(enriched, csvSource, { clearManual: clearManualOnImport });
      setBooksState(getBooks());
      posthog?.capture("csv_uploaded", {
        format: result.format,
        book_count: result.books.length,
        total_rows: result.totalRows,
        manual_cleared: clearManualOnImport,
      });

      const formatName =
        result.format === "goodreads"
          ? "Goodreads"
          : result.format === "hardcover"
            ? "Hardcover"
            : result.format === "storygraph"
              ? "The StoryGraph"
              : "CSV";
      const keptManual = clearManualOnImport ? 0 : manualBookCount;
      setImportInfo(
        `Imported ${result.books.length} want-to-read books from ${formatName} (${result.totalRows} total rows in file).${keptManual > 0 ? ` ${keptManual} manually added book${keptManual === 1 ? "" : "s"} preserved.` : ""}`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.onerror = () => setError("Failed to read file.");
    reader.readAsText(file);
  }

  async function startBskySignIn(handle: string) {
    if (!handle) return;
    setError(null);
    setBskySuggestionsOpen(false);
    try {
      posthog?.capture("bsky_sign_in_started", {
        handle_domain: handle.split(".").slice(-2).join("."),
      });
      await signInWithBluesky(handle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign in with Bluesky.");
    }
  }

  function handleBskySignIn(e: React.FormEvent) {
    e.preventDefault();
    startBskySignIn(bskyHandle.trim());
  }

  function handleBskyHandleChange(value: string) {
    setBskyHandle(value);
    const q = value.trim().replace(/^@/, "");
    if (bskyDebounceRef.current) clearTimeout(bskyDebounceRef.current);
    if (bskyAbortRef.current) bskyAbortRef.current.abort();
    if (q.length < 1) {
      setBskySuggestions([]);
      setBskySuggestionsOpen(false);
      return;
    }
    bskyDebounceRef.current = setTimeout(async () => {
      const ac = new AbortController();
      bskyAbortRef.current = ac;
      try {
        const actors = await searchHandleSuggestions(q, ac.signal);
        if (!ac.signal.aborted) {
          setBskySuggestions(actors);
          setBskySuggestionsOpen(actors.length > 0);
        }
      } catch {
        // Typeahead is optional; silently ignore network errors.
      }
    }, 250);
  }

  function handlePickBskySuggestion(s: HandleSuggestion) {
    setBskyHandle(s.handle);
    setBskySuggestions([]);
    setBskySuggestionsOpen(false);
    startBskySignIn(s.handle);
  }

  async function runBskyImport(session: OAuthSession, opts: { silent?: boolean } = {}) {
    setError(null);
    setImportInfo(null);
    setBskyImporting(true);
    try {
      const imported = await syncBookhive(session, { clearManual: clearManualOnImport });
      setBskyLastSync(new Date().toISOString());
      if (imported.length === 0) {
        if (!opts.silent) {
          setError(
            'No "want to read" books found in your Bluesky account. Make sure you have books marked as "wantToRead" in Bookhive.',
          );
        }
        posthog?.capture("bsky_import_failed", { reason: "no_want_to_read" });
        return;
      }
      setBooksState(getBooks());
      const keptManual = clearManualOnImport ? 0 : manualBookCount;
      setImportInfo(
        `Imported ${imported.length} want-to-read books from Bookhive (via Bluesky).${keptManual > 0 ? ` ${keptManual} manually added book${keptManual === 1 ? "" : "s"} preserved.` : ""}`,
      );
      posthog?.capture("bsky_imported", {
        book_count: imported.length,
        trigger: opts.silent ? "auto" : "manual",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to import from Bluesky.";
      setError(message);
      posthog?.capture("bsky_import_failed", { reason: "fetch_error", error: message });
    } finally {
      setBskyImporting(false);
    }
  }

  function handleBskyImport() {
    if (!bskySession) return;
    void runBskyImport(bskySession);
  }

  async function handleBskySignOut() {
    if (!bskySession) return;
    try {
      await signOut(bskySession.did);
    } catch {
      // Best-effort; clear local state regardless.
    }
    setBskySession(null);
    setBskyInfo(null);
    clearBookhiveLastSync();
    setBskyLastSync(null);
    posthog?.capture("bsky_signed_out");
  }

  function handleQuickAddSelect(item: LibbyMediaItem) {
    const author = item.creators?.find((c) => c.role === "Author")?.name ?? "";
    addBook({
      title: item.title,
      author,
      imageUrl: item.covers?.cover150Wide?.href,
      source: "unknown",
    });
    setBooksState(getBooks());
    posthog?.capture("book_added_from_search", { title: item.title, from: "setup" });
  }

  function handleClearBooks() {
    clearBooks();
    clearBookhiveLastSync();
    setBooksState([]);
    setBskyLastSync(null);
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">ShelfCheck Setup</h1>
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
              Import Reading List
            </h2>
          </div>

          {booksDone && (
            <div className="flex items-center justify-between gap-3 mb-4">
              <p className="text-green-600 dark:text-green-400 min-w-0 truncate">
                {books.length} books loaded
                {manualBookCount > 0 && (
                  <span className="text-gray-500 dark:text-gray-400">
                    {" "}
                    ({manualBookCount} manual)
                  </span>
                )}
                {books.find((b) => !b.manual)?.source &&
                  books.find((b) => !b.manual)!.source !== "unknown" && (
                    <span className="text-gray-500 dark:text-gray-400">
                      {" "}
                      from{" "}
                      {(() => {
                        const src = books.find((b) => !b.manual)!.source;
                        if (src === "goodreads") return "Goodreads";
                        if (src === "hardcover") return "Hardcover";
                        if (src === "storygraph") return "The StoryGraph";
                        return "Bookhive";
                      })()}
                    </span>
                  )}
              </p>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  onClick={() => setStep1ForceOpen((o) => !o)}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline"
                >
                  {step1Collapsed ? "Change" : "Hide"}
                </button>
                <button
                  onClick={handleClearBooks}
                  className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {step1Collapsed && !libraryDone && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
              <svg
                className="w-4 h-4 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              <span>Next: pick a Libby library below.</span>
            </div>
          )}

          {!step1Collapsed && (
            <div className="space-y-4">
              {/* Option 1: Bluesky / Bookhive (live sync) */}
              <div className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-900/15 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-sky-600 dark:text-sky-400"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.649 8.649 0 01-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z" />
                  </svg>
                  <h3 className="font-semibold text-sm text-sky-900 dark:text-sky-100">
                    Sync from Bluesky
                  </h3>
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300">
                    Live
                  </span>
                </div>
                <p className="text-xs text-sky-800/80 dark:text-sky-200/70">
                  Sign in to automatically sync your Bookhive "want to read" shelf. Updates daily
                  and on demand — no re-uploading CSVs.
                </p>
                {bskyInitializing ? (
                  <p className="text-sm text-gray-400">Checking Bluesky session...</p>
                ) : bskySession && bskyInfo ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 p-3 border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/20 rounded-lg">
                      <span className="text-sm text-gray-700 dark:text-gray-200 truncate">
                        Signed in as{" "}
                        <span className="font-medium">@{bskyInfo.handle ?? bskyInfo.did}</span>
                      </span>
                      <button
                        type="button"
                        onClick={handleBskySignOut}
                        className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline flex-shrink-0"
                      >
                        Sign out
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {bskyImporting
                          ? "Syncing Bookhive..."
                          : bskyLastSync
                            ? `Last synced ${formatRelativeTime(bskyLastSync)}`
                            : "Not yet synced"}
                      </span>
                      <button
                        type="button"
                        onClick={handleBskyImport}
                        disabled={bskyImporting}
                        className="px-3 py-1.5 text-sm bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors inline-flex items-center gap-1.5"
                      >
                        <svg
                          className={`w-3.5 h-3.5 ${bskyImporting ? "animate-spin" : ""}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        {bskyImporting ? "Syncing" : bskyLastSync ? "Refresh" : "Import"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleBskySignIn} className="relative">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={bskyHandle}
                        onChange={(e) => handleBskyHandleChange(e.target.value)}
                        onFocus={() => {
                          if (bskySuggestions.length > 0) setBskySuggestionsOpen(true);
                        }}
                        onBlur={() => {
                          // Delay so clicks on suggestions register before the list hides.
                          setTimeout(() => setBskySuggestionsOpen(false), 150);
                        }}
                        placeholder="your-handle.bsky.social"
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        data-1p-ignore="true"
                        data-lpignore="true"
                        data-bwignore="true"
                        data-form-type="other"
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-sm"
                      />
                      <button
                        type="submit"
                        disabled={bskyHandle.trim().length < 3}
                        className="px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
                      >
                        Sign in
                      </button>
                    </div>
                    {bskySuggestionsOpen && bskySuggestions.length > 0 && (
                      <ul className="absolute left-0 right-0 top-full mt-1 z-10 max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                        {bskySuggestions.map((s) => (
                          <li key={s.did}>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                // Prevent input blur from firing before click.
                                e.preventDefault();
                              }}
                              onClick={() => handlePickBskySuggestion(s)}
                              className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
                            >
                              {s.avatar ? (
                                <img
                                  src={s.avatar}
                                  alt=""
                                  className="w-7 h-7 rounded-full flex-shrink-0 bg-gray-100 dark:bg-gray-700"
                                />
                              ) : (
                                <span className="w-7 h-7 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 text-xs font-bold flex items-center justify-center flex-shrink-0">
                                  {s.handle[0]?.toUpperCase()}
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                {s.displayName && (
                                  <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">
                                    {s.displayName}
                                  </span>
                                )}
                                <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
                                  @{s.handle}
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </form>
                )}
              </div>

              {/* Option 2: CSV upload */}
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-amber-600 dark:text-amber-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12h6m-3-3v6m-9 1V7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                    />
                  </svg>
                  <h3 className="font-semibold text-sm text-amber-900 dark:text-amber-100">
                    Upload a CSV
                  </h3>
                </div>
                <p className="text-xs text-amber-800/80 dark:text-amber-200/70">
                  Export your reading list from Goodreads, Hardcover, or The StoryGraph. One-time
                  import — re-upload to refresh.
                </p>
                {!booksDone && (
                  <div className="space-y-1">
                    <details className="text-xs text-gray-600 dark:text-gray-400">
                      <summary className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-200">
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
                    <details className="text-xs text-gray-600 dark:text-gray-400">
                      <summary className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-200">
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
                    <details className="text-xs text-gray-600 dark:text-gray-400">
                      <summary className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-200">
                        How to export from The StoryGraph
                      </summary>
                      <ol className="list-decimal list-inside mt-2 space-y-1 pl-2">
                        <li>
                          Go to{" "}
                          <a
                            href="https://app.thestorygraph.com/manage_account"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-600 hover:text-amber-700 underline"
                          >
                            app.thestorygraph.com/manage_account
                          </a>
                        </li>
                        <li>Scroll to the "Manage Your Data" section</li>
                        <li>Click "Export StoryGraph Library" and download the CSV</li>
                      </ol>
                    </details>
                  </div>
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
                  file:bg-amber-100 file:text-amber-700
                  hover:file:bg-amber-200
                  dark:file:bg-amber-900/40 dark:file:text-amber-300
                  dark:hover:file:bg-amber-900/60
                  cursor-pointer"
                />
                {manualBookCount > 0 && (
                  <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <input
                      type="checkbox"
                      checked={clearManualOnImport}
                      onChange={(e) => setClearManualOnImport(e.target.checked)}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    Also remove {manualBookCount} manually added book
                    {manualBookCount === 1 ? "" : "s"} on import
                  </label>
                )}
              </div>

              {/* Option 3: Add one book via Libby */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-gray-600 dark:text-gray-400"
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
                  <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                    Add one book
                  </h3>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Search Libby directly to add a single book.
                </p>
                <BookSearchPicker
                  libraryKey={libraries[0]?.preferredKey}
                  onSelect={handleQuickAddSelect}
                  placeholder="Search Libby for a book..."
                  existingBooks={books}
                />
              </div>
            </div>
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
                      <img
                        src={lib.logoUrl}
                        alt=""
                        className="h-5 w-auto rounded bg-white p-0.5 flex-shrink-0"
                      />
                    ) : (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-green-200 dark:bg-green-800 text-[10px] font-bold text-green-700 dark:text-green-300 flex-shrink-0">
                        {lib.name[0]?.toUpperCase()}
                      </span>
                    )}
                    <span className="font-medium text-gray-900 dark:text-white">{lib.name}</span>
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
            {libraries.length > 0 ? (
              "Add another library to search across multiple systems."
            ) : (
              <>
                Search by library name or zip code. This should match the library you use on{" "}
                <a
                  href="https://libbyapp.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-600 hover:text-amber-700 underline"
                >
                  libbyapp.com
                </a>
                .
              </>
            )}
          </p>
          <form onSubmit={handleLibrarySearch} className="mb-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={libraryQuery}
                  onChange={(e) => setLibraryQuery(e.target.value)}
                  placeholder="Library name or zip code..."
                  className="w-full px-3 pr-8 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
                />
                {libraryQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setLibraryQuery("");
                      setSearchResults([]);
                      setHasSearched(false);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
                    <img
                      src={lib.logoUrl}
                      alt=""
                      className="h-5 w-auto rounded bg-white p-0.5 flex-shrink-0"
                    />
                  ) : (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-gray-200 dark:bg-gray-600 text-[10px] font-bold text-gray-600 dark:text-gray-300 flex-shrink-0">
                      {lib.name[0]?.toUpperCase()}
                    </span>
                  )}
                  <span className="font-medium text-gray-900 dark:text-white">{lib.name}</span>
                  {lib.type && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">{lib.type}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {hasSearched && !searching && searchResults.length === 0 && (
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
