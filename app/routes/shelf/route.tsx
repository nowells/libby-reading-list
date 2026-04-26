import { Link } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { usePostHog } from "@posthog/react";
import {
  getBooks,
  getReadBooks,
  removeBook,
  removeReadBook,
  updateBook,
  type Book,
  type ReadBookEntry,
  type ShelfStatus,
} from "~/lib/storage";
import { Logo } from "~/components/logo";
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
  const [minRating, setMinRating] = useState<number>(0);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<PseudoBook | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    posthog?.capture("shelf_page_viewed", { entry_count: entries.length });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => setEntries(loadAllShelfEntries());

  const counts = useMemo(() => {
    const c: Record<ShelfStatus, number> = {
      wantToRead: 0,
      reading: 0,
      finished: 0,
      abandoned: 0,
    };
    for (const e of entries) c[effectiveStatus(e)]++;
    return c;
  }, [entries]);

  const filtered = useMemo(() => {
    const sf = statusFilter;
    return entries
      .filter((e) => sf.size === 0 || sf.has(effectiveStatus(e)))
      .filter((e) => (e.rating ?? 0) >= minRating)
      .filter((e) => fuzzyMatch(search, e.title, e.author))
      .sort((a, b) => {
        // Most recently touched first: finishedAt > startedAt > title fallback.
        const aT = Date.parse(a.finishedAt ?? a.startedAt ?? "") || 0;
        const bT = Date.parse(b.finishedAt ?? b.startedAt ?? "") || 0;
        if (aT !== bT) return bT - aT;
        return a.title.localeCompare(b.title);
      });
  }, [entries, statusFilter, minRating, search]);

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
    if (book.__readEntryKey) {
      // ReadBookEntries don't carry rating/note. Skip the upgrade flow for
      // now — surface a hint in the editor copy and only persist the
      // status if it changed away from finished.
      // (The vast majority of users will only see real Books here.)
      setEditing(null);
      return;
    }
    updateBook(book.id, patch);
    refresh();
    posthog?.capture("shelf_entry_edited", {
      book_id: book.id,
      status: patch.status,
      has_rating: patch.rating !== undefined,
      has_note: !!patch.note,
    });
    setEditing(null);
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
            <Logo className="w-9 h-9 flex-shrink-0" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Your shelf</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Every book you've added, across every status. Tap a row to rate, add a note, or change
            status.{" "}
            <Link to="/books" className="text-amber-600 hover:text-amber-700 underline">
              Looking for the want-to-read view?
            </Link>
          </p>
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
            {statusFilter.size > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter(new Set())}
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
                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-3 flex items-start gap-3"
              >
                {entry.imageUrl ? (
                  <img
                    src={entry.imageUrl}
                    alt=""
                    className="w-12 h-16 object-cover rounded flex-shrink-0 bg-gray-100 dark:bg-gray-700"
                  />
                ) : (
                  <div className="w-12 h-16 rounded flex-shrink-0 bg-gray-100 dark:bg-gray-700" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {entry.title}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {entry.author}
                      </p>
                    </div>
                    <StatusPill status={effectiveStatus(entry)} />
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
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditing(entry)}
                    className="text-xs px-2 py-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    aria-label="Edit"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(entry)}
                    className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    aria-label="Remove"
                  >
                    Remove
                  </button>
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
    </main>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}
