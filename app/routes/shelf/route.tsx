import { Link } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePostHog } from "@posthog/react";
import { CoverImage } from "~/components/cover-image";
import { SourceLinks } from "~/components/source-links";
import {
  addBook,
  getBooks,
  getLibraries,
  getReadBooks,
  removeBook,
  removeReadBook,
  updateBook,
  type Book,
  type ReadBookEntry,
  type ShelfStatus,
} from "~/lib/storage";
import { enrichBooksWithWorkId } from "~/lib/openlibrary";
import { BookSearchPicker } from "~/components/book-search-picker";
import { getAuthor } from "~/components/book-search-utils";
import type { LibbyMediaItem } from "~/lib/libby";
import {
  StatusPill,
  SHELF_STATUSES,
  statusLabel,
  effectiveStatus,
} from "~/components/shelf-status";
import { StarRating } from "~/components/star-rating";
import { BookEditor, type BookEditorPatch } from "~/components/book-editor";
import { bookKey } from "~/lib/dedupe";
import { fuzzyMatch, PAGE_SIZE } from "~/routes/books/lib/utils";
import { BookhiveSyncStatus } from "~/routes/books/components/bookhive-sync-status";

export const handle = { navActive: "shelf" };

export function meta() {
  return [{ title: "Shelf | ShelfCheck" }];
}

/**
 * Promote a legacy `ReadBookEntry` (which carries only title/author/workId)
 * into a `Book` view so /shelf can render every shelf entry through one
 * card component. The `pseudo` flag tells the action handlers to delete
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

/** Combine Books and legacy ReadBookEntries into a single shelf view, deduped by content key. */
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

export default function Shelf() {
  const posthog = usePostHog();
  const [entries, setEntries] = useState<PseudoBook[]>(() => loadAllShelfEntries());
  const [statusFilter, setStatusFilter] = useState<Set<ShelfStatus>>(new Set());
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const [minRating, setMinRating] = useState<number>(0);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<PseudoBook | null>(null);
  const [finding, setFinding] = useState<PseudoBook | null>(null);
  const [adding, setAdding] = useState(false);
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<
    { id: number; message: string; type: "success" | "error" }[]
  >([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    posthog?.capture("shelf_page_viewed", { entry_count: entries.length });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => setEntries(loadAllShelfEntries());

  const showToast = (message: string, type: "success" | "error" = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  const counts = useMemo(() => {
    const c: Record<ShelfStatus, number> = {
      wantToRead: 0,
      reading: 0,
      finished: 0,
      abandoned: 0,
    };
    let unmatched = 0;
    for (const e of entries) {
      c[effectiveStatus(e)]++;
      if (!e.workId) unmatched++;
    }
    return { ...c, unmatched };
  }, [entries]);

  const filtered = useMemo(() => {
    const sf = statusFilter;
    return entries
      .filter((e) => sf.size === 0 || sf.has(effectiveStatus(e)))
      .filter((e) => !unmatchedOnly || !e.workId)
      .filter((e) => (e.rating ?? 0) >= minRating)
      .filter((e) => fuzzyMatch(search, e.title, e.author))
      .sort((a, b) => {
        // Most recently touched first: finishedAt > startedAt > title fallback.
        const aT = Date.parse(a.finishedAt ?? a.startedAt ?? "") || 0;
        const bT = Date.parse(b.finishedAt ?? b.startedAt ?? "") || 0;
        if (aT !== bT) return bT - aT;
        return a.title.localeCompare(b.title);
      });
  }, [entries, statusFilter, unmatchedOnly, minRating, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toggleStatus = (s: ShelfStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
    setPage(1);
  };

  const handleSave = (book: PseudoBook, patch: BookEditorPatch) => {
    let bookId: string;

    if (book.__readEntryKey) {
      // Promote ReadBookEntry to a real Book so we can persist rating/note/status
      const { __readEntryKey, id: _pseudoId, ...bookData } = book;
      addBook({ ...bookData, ...patch });
      removeReadBook(__readEntryKey);
      const allBooks = getBooks();
      bookId = allBooks[allBooks.length - 1].id;
    } else {
      bookId = book.id;
      updateBook(bookId, patch);
    }

    refresh();
    posthog?.capture("shelf_entry_edited", {
      book_id: bookId,
      status: patch.status,
      has_rating: patch.rating !== undefined,
      has_note: !!patch.note,
    });
    setEditing(null);
  };

  const handleFindSelect = (book: PseudoBook, item: LibbyMediaItem) => {
    const author = getAuthor(item);
    const imageUrl = item.covers?.cover150Wide?.href;

    let bookId: string;

    if (book.__readEntryKey) {
      // Promote ReadBookEntry to a real Book
      const newBook: Omit<Book, "id" | "manual"> = {
        title: item.title,
        author,
        source: "unknown",
        status: book.status ?? "finished",
        finishedAt: book.finishedAt,
        startedAt: book.startedAt,
        ...(imageUrl ? { imageUrl } : {}),
      };
      addBook(newBook);
      removeReadBook(book.__readEntryKey);
      const allBooks = getBooks();
      bookId = allBooks[allBooks.length - 1].id;
    } else {
      bookId = book.id;
      updateBook(bookId, {
        title: item.title,
        author,
        ...(imageUrl ? { imageUrl } : {}),
        source: book.source,
      });
    }

    // Close modal, mark as enriching, refresh
    setFinding(null);
    setEnrichingIds((prev) => new Set(prev).add(bookId));
    refresh();
    posthog?.capture("shelf_entry_found", { book_id: bookId, selected_title: item.title });

    // Enrich with Open Library data in the background
    const updated = { ...book, id: bookId, title: item.title, author };
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
          refresh();
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

  const handleAddSelect = (item: LibbyMediaItem) => {
    const author = getAuthor(item);
    const imageUrl = item.covers?.cover150Wide?.href;
    addBook({
      title: item.title,
      author,
      source: "unknown",
      status: "wantToRead",
      ...(imageUrl ? { imageUrl } : {}),
    });
    const allBooks = getBooks();
    const bookId = allBooks[allBooks.length - 1].id;
    setAdding(false);
    setEnrichingIds((prev) => new Set(prev).add(bookId));
    refresh();
    posthog?.capture("shelf_book_added", { book_id: bookId, title: item.title });

    enrichBooksWithWorkId([
      { id: bookId, title: item.title, author, source: "unknown", status: "wantToRead" },
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
          refresh();
          showToast(`Added "${item.title}" and matched with Open Library`);
        } else {
          showToast(`Added "${item.title}" (no Open Library match)`, "error");
        }
      })
      .catch(() => {
        showToast(`Added "${item.title}" but enrichment failed`, "error");
      })
      .finally(() => {
        setEnrichingIds((prev) => {
          const next = new Set(prev);
          next.delete(bookId);
          return next;
        });
      });
  };

  const handleQuickStatus = (book: PseudoBook, status: ShelfStatus) => {
    if (book.__readEntryKey) return;
    updateBook(book.id, { status });
    refresh();
    posthog?.capture("shelf_quick_status", { book_id: book.id, status });
  };

  const handleDelete = (book: PseudoBook) => {
    if (!confirm(`Remove "${book.title}" from your shelf?`)) return;
    if (book.__readEntryKey) {
      removeReadBook(book.__readEntryKey);
    } else {
      removeBook(book.id);
    }
    refresh();
    posthog?.capture("shelf_entry_removed", { book_id: book.id });
  };

  return (
    <main className="min-h-screen py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex-1 min-w-0 truncate">
              Your shelf
            </h1>
            <button
              type="button"
              onClick={() => setAdding(true)}
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
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Every book you've added, across every status. Tap a row to rate, add a note, or change
              status.{" "}
              <Link to="/books" className="text-amber-600 hover:text-amber-700 underline">
                Looking for the want-to-read view?
              </Link>
            </p>
            <BookhiveSyncStatus onBooksChanged={refresh} />
          </div>
        </header>

        {/* Filter bar */}
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {SHELF_STATUSES.map((s) => {
              const active = statusFilter.has(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    active
                      ? "bg-amber-600 border-amber-600 text-white"
                      : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                  }`}
                >
                  {statusLabel(s)} ({counts[s]})
                </button>
              );
            })}
            <span className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-0.5" />
            <button
              type="button"
              onClick={() => {
                setUnmatchedOnly((v) => !v);
                setPage(1);
              }}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                unmatchedOnly
                  ? "bg-amber-600 border-amber-600 text-white"
                  : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
              }`}
            >
              Unmatched ({counts.unmatched})
            </button>
            {(statusFilter.size > 0 || unmatchedOnly) && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter(new Set());
                  setUnmatchedOnly(false);
                }}
                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 underline ml-1"
              >
                clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search title or author..."
              className="flex-1 min-w-[200px] px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm placeholder-gray-400"
            />
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              Min rating
              <StarRating
                value={minRating === 0 ? undefined : minRating}
                onChange={(v) => {
                  setMinRating(v ?? 0);
                  setPage(1);
                }}
                size={16}
              />
            </label>
          </div>
        </section>

        {/* Toasts */}
        {toasts.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs animate-[fadeIn_0.2s_ease-out] ${
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

        {/* List */}
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">
            No books match the current filters.
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((entry) => (
              <li
                key={entry.id}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden"
              >
                <div className="p-3 flex items-start gap-3">
                  {entry.workId ? (
                    <Link
                      to={`/book/${entry.workId}`}
                      aria-label={`View details for ${entry.title}`}
                    >
                      <CoverImage
                        src={
                          entry.imageUrl ??
                          (entry.isbn13
                            ? `https://covers.openlibrary.org/b/isbn/${entry.isbn13}-M.jpg`
                            : undefined)
                        }
                        alt={entry.title}
                      />
                    </Link>
                  ) : (
                    <CoverImage
                      src={
                        entry.imageUrl ??
                        (entry.isbn13
                          ? `https://covers.openlibrary.org/b/isbn/${entry.isbn13}-M.jpg`
                          : undefined)
                      }
                      alt={entry.title}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {entry.workId ? (
                          <Link
                            to={`/book/${entry.workId}`}
                            className="text-sm font-medium text-gray-900 dark:text-white truncate hover:text-amber-600 dark:hover:text-amber-400 block"
                          >
                            {entry.canonicalTitle ?? entry.title}
                          </Link>
                        ) : (
                          <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {entry.canonicalTitle ?? entry.title}
                          </h3>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {entry.canonicalAuthor ?? entry.author}
                        </p>
                      </div>
                      {!entry.__readEntryKey ? (
                        <StatusDropdown
                          status={effectiveStatus(entry)}
                          onSelect={(s) => handleQuickStatus(entry, s)}
                        />
                      ) : (
                        <StatusPill status={effectiveStatus(entry)} />
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
                      {entry.rating !== undefined && (
                        <StarRating value={entry.rating} readOnly size={14} />
                      )}
                      {entry.finishedAt && <span>Finished {fmtDate(entry.finishedAt)}</span>}
                      {!entry.finishedAt && entry.startedAt && (
                        <span>Started {fmtDate(entry.startedAt)}</span>
                      )}
                    </div>
                    {entry.note && (
                      <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-300 line-clamp-2">
                        {entry.note}
                      </p>
                    )}
                  </div>
                </div>
                {/* Card footer: source links + actions */}
                {enrichingIds.has(entry.id) && (
                  <div className="px-3 pt-1.5 border-t border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                      <svg
                        className="w-3.5 h-3.5 animate-spin"
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
                      Matching with Open Library...
                    </div>
                  </div>
                )}
                <div
                  className={`flex items-center justify-between px-3 py-1.5 ${enrichingIds.has(entry.id) ? "" : "border-t border-gray-100 dark:border-gray-700"}`}
                >
                  <div className="flex items-center gap-3">
                    <SourceLinks book={entry} />
                  </div>
                  <div className="flex items-center gap-1">
                    {entry.workId ? (
                      <button
                        type="button"
                        onClick={() => setEditing(entry)}
                        className="text-xs px-2 py-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        aria-label="Edit"
                      >
                        Edit
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setFinding(entry)}
                        disabled={enrichingIds.has(entry.id)}
                        className="text-xs px-2 py-1 rounded text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
                        aria-label="Find match"
                      >
                        {enrichingIds.has(entry.id) ? "Matching..." : "Find"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(entry)}
                      className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      aria-label="Remove"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-4 text-sm">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50"
            >
              Prev
            </button>
            <span className="text-gray-500 dark:text-gray-400">
              Page {safePage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {editing && (
        <BookEditor
          book={editing}
          onSave={(patch) => handleSave(editing, patch)}
          onClose={() => setEditing(null)}
        />
      )}

      {adding && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setAdding(false)} />
          <div
            role="dialog"
            aria-label="Add a book"
            className="relative w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4"
          >
            <div className="mb-3">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">Add a book</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Search for a book to add to your shelf.
              </p>
            </div>
            <BookSearchPicker
              libraryKey={getLibraries()[0]?.preferredKey}
              onSelect={handleAddSelect}
              onCancel={() => setAdding(false)}
              existingBooks={entries.map((e) => ({ title: e.title, author: e.author ?? "" }))}
              placeholder="Search by title or author..."
            />
          </div>
        </div>
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
              libraryKey={getLibraries()[0]?.preferredKey}
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

function StatusDropdown({
  status,
  onSelect,
}: {
  status: ShelfStatus;
  onSelect: (s: ShelfStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change status"
        aria-expanded={open}
      >
        <StatusPill status={status} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg py-1 min-w-[140px]">
          {SHELF_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onSelect(s);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                s === status
                  ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 font-medium"
                  : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
              }`}
            >
              {statusLabel(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}
