import { usePostHog } from "@posthog/react";
import { Link } from "react-router";
import { useState, useEffect, useMemo, useRef } from "react";
import { importBooks, type SkippedRow } from "~/lib/csv-parser";
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
  clearBookhiveLastSync,
  addAuthor,
  getAuthors,
  clearAuthors,
  getSkippedRows,
  setSkippedRows as saveSkippedRows,
  clearSkippedRows,
  onStorageMutation,
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
import { NotificationSettingsPanel } from "~/components/notification-settings";
import {
  initSession,
  signInWithBluesky,
  signOut,
  refreshPdsSync,
  getLastPdsSync,
  searchHandleSuggestions,
  getLastSignedInAccount,
  clearLastSignedInAccount,
  type AtprotoSessionInfo,
  type HandleSuggestion,
  type RememberedBskyAccount,
} from "~/lib/atproto";
import type { OAuthSession } from "@atproto/oauth-client-browser";

const SOURCE_LABELS: Record<string, string> = {
  bookhive: "Bookhive",
  popfeed: "Popfeed",
  goodreads: "Goodreads",
  hardcover: "Hardcover",
  storygraph: "The StoryGraph",
  lyndi: "Lyndi CSV",
  unknown: "CSV",
  manual: "manual",
};

// Display order for the per-source breakdown: live-sync first, then CSV
// sources alphabetically, then unknown CSVs, then manual additions.
const SOURCE_DISPLAY_ORDER = [
  "bookhive",
  "popfeed",
  "goodreads",
  "hardcover",
  "storygraph",
  "lyndi",
  "unknown",
  "manual",
];

function summarizeSources(books: Book[]): string[] {
  const counts = new Map<string, number>();
  for (const b of books) {
    const key = b.manual ? "manual" : b.source;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return SOURCE_DISPLAY_ORDER.filter((k) => counts.has(k)).map(
    (k) => `${counts.get(k)} ${SOURCE_LABELS[k]}`,
  );
}

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

function SkippedRowsPanel({
  skippedRows,
  libraries,
  onBookAdded,
  onDismiss,
}: {
  skippedRows: SkippedRow[];
  libraries: LibraryConfig[];
  onBookAdded: () => void;
  onDismiss: (idx: number) => void;
}) {
  const [activeSearch, setActiveSearch] = useState<number | null>(null);
  const hasLibrary = libraries.length > 0;

  const handleSelect = (item: LibbyMediaItem) => {
    const author = item.creators?.find((c) => c.role === "Author")?.name ?? "";
    addBook({
      title: item.title,
      author,
      imageUrl: item.covers?.cover150Wide?.href,
      source: "lyndi",
    });
    onBookAdded();
    if (activeSearch !== null) {
      onDismiss(activeSearch);
      setActiveSearch(null);
    }
  };

  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <svg
          className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
        <h3 className="font-semibold text-sm text-yellow-800 dark:text-yellow-200">
          {skippedRows.length} row{skippedRows.length === 1 ? "" : "s"} could not be auto-imported
        </h3>
      </div>
      <p className="text-xs text-yellow-700/80 dark:text-yellow-300/70 mb-3">
        These rows had an author but no title. Search your library to add them manually.
      </p>
      <div className="space-y-2">
        {skippedRows.map((row, idx) => (
          <div
            key={`${row.author}-${row.note}`}
            className="bg-white dark:bg-gray-800 rounded-lg border border-yellow-100 dark:border-yellow-900/50 overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-2">
              <div className="min-w-0">
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {row.author}
                </span>
                {row.note && (
                  <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{row.note}</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {hasLibrary && (
                  <button
                    onClick={() => setActiveSearch(activeSearch === idx ? null : idx)}
                    className="text-xs px-2.5 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60 transition-colors"
                  >
                    {activeSearch === idx ? "Close" : "Search"}
                  </button>
                )}
                <button
                  onClick={() => onDismiss(idx)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  title="Dismiss"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {activeSearch === idx && hasLibrary && (
              <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-700">
                <BookSearchPicker
                  libraryKey={libraries[0].preferredKey}
                  onSelect={handleSelect}
                  onCancel={() => setActiveSearch(null)}
                  placeholder={`Search for books by ${row.author}...`}
                  initialQuery={`${row.author}${row.note ? ` ${row.note}` : ""}`}
                  existingBooks={[]}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={() => {
          for (let i = skippedRows.length - 1; i >= 0; i--) onDismiss(i);
        }}
        className="mt-3 text-xs text-yellow-600 hover:text-yellow-700 dark:text-yellow-400 dark:hover:text-yellow-300"
      >
        Dismiss all
      </button>
    </div>
  );
}

export default function Setup() {
  const posthog = usePostHog();
  const [books, setBooksState] = useState<Book[]>([]);
  const [libraries, setLibrariesState] = useState<LibraryConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);

  const [clearManualOnImport, setClearManualOnImport] = useState(false);
  const manualBookCount = books.filter((b) => b.manual).length;
  const [skippedRows, setSkippedRowsState] = useState<SkippedRow[]>([]);

  // Wrapper that persists skipped rows to localStorage
  function setSkippedRows(rows: SkippedRow[] | ((prev: SkippedRow[]) => SkippedRow[])) {
    setSkippedRowsState((prev) => {
      const next = typeof rows === "function" ? rows(prev) : rows;
      saveSkippedRows(next);
      return next;
    });
  }

  // Library search state
  const [libraryQuery, setLibraryQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LibbyLibrary[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectingLibrary, setSelectingLibrary] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CSV import progress: null when idle, otherwise tracks the active phase
  // and Open Library enrichment progress so the user sees movement instead
  // of a frozen UI while N HTTP lookups complete.
  const [csvImport, setCsvImport] = useState<{
    phase: "reading" | "parsing" | "enriching" | "saving";
    fileName?: string;
    done: number;
    total: number;
  } | null>(null);

  // Bluesky / ATProto state
  const [bskySession, setBskySession] = useState<OAuthSession | null>(null);
  const [bskyInfo, setBskyInfo] = useState<AtprotoSessionInfo | null>(null);
  const [bskyInitializing, setBskyInitializing] = useState(true);
  const [bskyHandle, setBskyHandle] = useState("");
  const [bskyImporting, setBskyImporting] = useState(false);
  const [bskyLastSync, setBskyLastSync] = useState<string | null>(null);
  const [bskySuggestions, setBskySuggestions] = useState<HandleSuggestion[]>([]);
  const [bskySuggestionsOpen, setBskySuggestionsOpen] = useState(false);
  // Mirror of the localStorage-backed last-signed-in account. When the OAuth
  // session is gone but this is set, we offer a one-click reauthenticate
  // instead of forcing the user to retype their handle.
  const [rememberedBskyAccount, setRememberedBskyAccount] = useState<RememberedBskyAccount | null>(
    null,
  );

  // Section 1 (Bluesky) collapses once signed in; section 2 (books)
  // collapses once books are loaded. Tracks manual override.
  const [step1ForceOpen, setStep1ForceOpen] = useState(false);
  const [step2ForceOpen, setStep2ForceOpen] = useState(false);
  const bskyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bskyAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setBooksState(getBooks());
    setLibrariesState(getLibraries());
    setSkippedRowsState(getSkippedRows());
  }, []);

  // Auto-sync (BookHive / Popfeed pull, PDS reconcile) writes books in the
  // background through setImportedBooks. Subscribe so the source breakdown
  // and book counts refresh without needing a page reload.
  useEffect(() => {
    return onStorageMutation((m) => {
      if (m.kind === "books:bulkSet" || m.kind === "book:added" || m.kind === "book:removed") {
        setBooksState(getBooks());
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Read what we remembered from a prior visit before initSession resolves
    // so the reauth UI can render the moment we know there's no live session.
    setRememberedBskyAccount(getLastSignedInAccount());
    initSession()
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setBskySession(result.session);
          setBskyInfo(result.info);
          // initSession() persists this on success; sync our mirror so the
          // reauth UI picks it up if the session is later lost on this page.
          setRememberedBskyAccount({ did: result.info.did, handle: result.info.handle });
          setBskyLastSync(getLastPdsSync(result.info.did));
          // initSession already attached the sync engine, pulled from
          // BookHive + Popfeed, and armed the 15-minute auto-resync timer,
          // so local state already reflects PDS state by the time we render.
          setBooksState(getBooks());
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
  }, []);

  const bskyDone = !!(bskySession && bskyInfo);
  const booksDone = books.length > 0;
  const libraryDone = libraries.length > 0;
  const allDone = booksDone && libraryDone;
  const step1Collapsed = bskyDone && !step1ForceOpen;
  const step2Collapsed = booksDone && !step2ForceOpen;
  const sourceBreakdown = useMemo(() => summarizeSources(books), [books]);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setImportInfo(null);
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvImport({ phase: "reading", fileName: file.name, done: 0, total: 0 });

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setCsvImport({ phase: "parsing", fileName: file.name, done: 0, total: 0 });
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
          const emptyError = `No book rows found in the CSV. Found ${result.totalRows} total rows.`;
          setError(emptyError);
          posthog?.capture("csv_upload_failed", {
            error: emptyError,
            format: result.format,
            total_rows: result.totalRows,
          });
          return;
        }

        setCsvImport({
          phase: "enriching",
          fileName: file.name,
          done: 0,
          total: result.books.length,
        });
        const enriched = await enrichBooksWithWorkId(result.books, {
          onProgress: (done, total) =>
            setCsvImport({ phase: "enriching", fileName: file.name, done, total }),
        });

        setCsvImport({
          phase: "saving",
          fileName: file.name,
          done: result.books.length,
          total: result.books.length,
        });
        // All books in a CSV batch share the same source (set by csv-parser);
        // pass it explicitly so we only replace prior books from this source.
        const csvSource = enriched[0]?.source ?? "unknown";
        setImportedBooks(enriched, csvSource, { clearManual: clearManualOnImport });
        setBooksState(getBooks());

        // Save authors extracted from Lyndi-format CSVs
        if (result.authors.length > 0) {
          for (const author of result.authors) {
            addAuthor({ name: author.name, olKey: author.olKey });
          }
        }

        // Track skipped rows so the user can manually search for them
        setSkippedRows(result.skipped);

        posthog?.capture("csv_uploaded", {
          format: result.format,
          book_count: result.books.length,
          author_count: result.authors.length,
          skipped_count: result.skipped.length,
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
                : result.format === "lyndi"
                  ? "Lyndi CSV"
                  : "CSV";
        const keptManual = clearManualOnImport ? 0 : manualBookCount;
        const authorInfo =
          result.authors.length > 0
            ? ` Also added ${result.authors.length} author${result.authors.length === 1 ? "" : "s"} to follow.`
            : "";
        const skippedInfo =
          result.skipped.length > 0
            ? ` ${result.skipped.length} row${result.skipped.length === 1 ? "" : "s"} could not be imported (see below).`
            : "";
        setImportInfo(
          `Imported ${result.books.length} books from ${formatName} (${result.totalRows} total rows in file).${keptManual > 0 ? ` ${keptManual} manually added book${keptManual === 1 ? "" : "s"} preserved.` : ""}${authorInfo}${skippedInfo}`,
        );
        if (fileInputRef.current) fileInputRef.current.value = "";
      } finally {
        setCsvImport(null);
      }
    };
    reader.onerror = () => {
      setError("Failed to read file.");
      setCsvImport(null);
    };
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

  async function handlePdsResync() {
    if (!bskySession || !bskyInfo) return;
    setBskyImporting(true);
    setError(null);
    try {
      await refreshPdsSync(bskyInfo.did);
      setBskyLastSync(getLastPdsSync(bskyInfo.did));
      setBooksState(getBooks());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resync.");
    } finally {
      setBskyImporting(false);
    }
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
    // Explicit sign-out also forgets the remembered account so the empty
    // sign-in form (not the reauth UI) is what shows up next.
    setRememberedBskyAccount(null);
    posthog?.capture("bsky_signed_out");
  }

  function handleSwitchAccounts() {
    clearLastSignedInAccount();
    setRememberedBskyAccount(null);
    posthog?.capture("bsky_switch_accounts");
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
    clearAuthors();
    clearSkippedRows();
    clearBookhiveLastSync();
    setBooksState([]);
    setSkippedRowsState([]);
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
    <main className="min-h-screen py-12 px-4">
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

        {/* Step 1: Bluesky Login */}
        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${bskyDone ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300"}`}
            >
              {bskyDone ? "\u2713" : "1"}
            </span>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Connect Bluesky</h2>
            <span className="text-xs text-gray-500 dark:text-gray-400 italic">Optional</span>
          </div>

          {bskyDone && (
            <div className="flex items-center justify-between gap-3 mb-4">
              <p className="text-green-600 dark:text-green-400 min-w-0 truncate">
                Signed in as @{bskyInfo!.handle ?? bskyInfo!.did}
              </p>
              <button
                onClick={() => setStep1ForceOpen((o) => !o)}
                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline flex-shrink-0"
              >
                {step1Collapsed ? "Manage" : "Hide"}
              </button>
            </div>
          )}

          {!step1Collapsed && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Sign in with Bluesky to sync your reading list via the AT Protocol. Your books,
                followed authors, and dismissed works are stored on your PDS and follow you across
                devices. ShelfCheck also pulls your BookHive and Popfeed to-read lists automatically
                every 15 minutes.
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 italic">
                This is optional — you can skip this step and use ShelfCheck with local storage
                only. Your data stays in your browser and nothing is sent to any server.
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
                        ? "Syncing with PDS..."
                        : bskyLastSync
                          ? `Last synced ${formatRelativeTime(bskyLastSync)}`
                          : "Not yet synced"}
                    </span>
                    <button
                      type="button"
                      onClick={handlePdsResync}
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
                      {bskyImporting ? "Syncing" : "Resync"}
                    </button>
                  </div>
                </div>
              ) : rememberedBskyAccount ? (
                <div className="space-y-2">
                  <div className="p-3 border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/20 rounded-lg space-y-2">
                    <p className="text-sm text-gray-700 dark:text-gray-200">
                      Your Bluesky session expired. Sign back in as{" "}
                      <span className="font-medium">
                        @{rememberedBskyAccount.handle ?? rememberedBskyAccount.did}
                      </span>
                      .
                    </p>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          const target = rememberedBskyAccount.handle ?? rememberedBskyAccount.did;
                          posthog?.capture("bsky_reauth_started");
                          void startBskySignIn(target);
                        }}
                        className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors text-sm"
                      >
                        Reauthenticate as @
                        {rememberedBskyAccount.handle ?? rememberedBskyAccount.did}
                      </button>
                      <button
                        type="button"
                        onClick={handleSwitchAccounts}
                        className="text-xs text-sky-700 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100 underline"
                      >
                        Use a different account
                      </button>
                    </div>
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
          )}
        </section>

        {/* Step 2: Import Reading List (CSV / manual) */}
        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${booksDone ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"}`}
            >
              {booksDone ? "\u2713" : "2"}
            </span>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Add Books</h2>
          </div>

          {booksDone && (
            <div className="flex items-center justify-between gap-3 mb-4">
              <p className="text-green-600 dark:text-green-400 min-w-0">
                {books.length} books loaded
                {sourceBreakdown.length > 0 && (
                  <span className="text-gray-500 dark:text-gray-400">
                    {" \u2014 "}
                    {sourceBreakdown.map((s, i) => (
                      <span key={s}>
                        {i > 0 && " \u00b7 "}
                        <span className="whitespace-nowrap">{s}</span>
                      </span>
                    ))}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  onClick={() => setStep2ForceOpen((o) => !o)}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline"
                >
                  {step2Collapsed ? "Change" : "Hide"}
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

          {step2Collapsed && !libraryDone && (
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

          {!step2Collapsed && (
            <div className="space-y-4">
              {/* Option A: CSV upload */}
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
                  Export your reading list from Goodreads, Hardcover, The StoryGraph, or use a
                  simple Lyndi CSV. One-time import — re-upload to refresh.
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
                    <details className="text-xs text-gray-600 dark:text-gray-400">
                      <summary className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-200">
                        How to structure a Lyndi CSV
                      </summary>
                      <div className="mt-2 space-y-2 pl-2">
                        <p>
                          Create a CSV file with <strong>Title</strong> and <strong>Author</strong>{" "}
                          columns. Extra rows at the top (like a heading) are fine — we'll
                          auto-detect the header row.
                        </p>
                        <div className="bg-gray-100 dark:bg-gray-700 rounded p-2 font-mono text-[11px] leading-relaxed">
                          Books to Read
                          <br />
                          Title,Author
                          <br />
                          The Great Gatsby,F. Scott Fitzgerald
                          <br />
                          ,Tana French
                          <br />
                          In the Woods,Tana French
                        </div>
                        <ul className="list-disc list-inside space-y-1">
                          <li>
                            Rows with both <strong>Title</strong> and <strong>Author</strong> are
                            imported as books
                          </li>
                          <li>
                            Rows with only an <strong>Author</strong> (no title) are added as
                            followed authors on the Authors page
                          </li>
                          <li>
                            Lyndi books have the lowest merge priority — they'll be replaced by
                            matches from Goodreads, Hardcover, or StoryGraph imports
                          </li>
                          <li>
                            Re-uploading a Lyndi CSV replaces only Lyndi-sourced books, leaving
                            other sources untouched
                          </li>
                        </ul>
                      </div>
                    </details>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileUpload}
                  disabled={csvImport !== null}
                  className="block w-full text-sm text-gray-500 dark:text-gray-400
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-lg file:border-0
                  file:text-sm file:font-medium
                  file:bg-amber-100 file:text-amber-700
                  hover:file:bg-amber-200
                  dark:file:bg-amber-900/40 dark:file:text-amber-300
                  dark:hover:file:bg-amber-900/60
                  cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                />
                {csvImport && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                      <svg
                        className="w-3.5 h-3.5 animate-spin flex-shrink-0"
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
                      <span className="min-w-0 truncate">
                        {csvImport.phase === "reading" && (
                          <>Reading{csvImport.fileName ? ` ${csvImport.fileName}` : "..."}</>
                        )}
                        {csvImport.phase === "parsing" && <>Parsing CSV...</>}
                        {csvImport.phase === "enriching" && (
                          <>
                            Looking up books on Open Library… {csvImport.done}/{csvImport.total}
                          </>
                        )}
                        {csvImport.phase === "saving" && <>Saving...</>}
                      </span>
                    </div>
                    {csvImport.phase === "enriching" && csvImport.total > 0 && (
                      <div className="w-full h-1 bg-amber-100 dark:bg-amber-900/40 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 dark:bg-amber-400 transition-all duration-200"
                          style={{
                            width: `${Math.round((csvImport.done / csvImport.total) * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
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

              {/* Option B: Add one book via Libby */}
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

        {/* Step 3: Library Selection */}
        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${libraryDone ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"}`}
            >
              {libraryDone ? "\u2713" : "3"}
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

        {/* Step 4: Notifications (optional) */}
        {allDone && (
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                4
              </span>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Notifications</h2>
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">Optional</span>
            </div>
            <NotificationSettingsPanel />
          </section>
        )}

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

        {/* Skipped rows from Lyndi CSV — persisted so they survive navigation */}
        {skippedRows.length > 0 && (
          <SkippedRowsPanel
            skippedRows={skippedRows}
            libraries={libraries}
            onBookAdded={() => setBooksState(getBooks())}
            onDismiss={(idx) => setSkippedRows((prev) => prev.filter((_, i) => i !== idx))}
          />
        )}
      </div>
    </main>
  );
}
