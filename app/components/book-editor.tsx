import { useEffect, useState } from "react";
import type { Book, ShelfStatus } from "~/lib/storage";
import { StarRating } from "./star-rating";
import { SHELF_STATUSES, effectiveStatus, statusLabel } from "./shelf-status";

export interface BookEditorPatch {
  status?: ShelfStatus;
  rating?: number | undefined;
  note?: string | undefined;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
}

/**
 * Modal editor for the per-book metadata that lives on
 * org.shelfcheck.shelf.entry: status, rating, note, started/finished dates.
 * Save emits the patch as a `Partial<Book>` so the caller can route it
 * through `updateBook` (which then propagates to the user's PDS via the
 * sync engine).
 */
export function BookEditor({
  book,
  onSave,
  onClose,
}: {
  book: Book;
  onSave: (patch: BookEditorPatch) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ShelfStatus>(effectiveStatus(book));
  const [rating, setRating] = useState<number | undefined>(book.rating);
  const [note, setNote] = useState<string>(book.note ?? "");
  const [startedAt, setStartedAt] = useState<string>(toDateInput(book.startedAt));
  const [finishedAt, setFinishedAt] = useState<string>(toDateInput(book.finishedAt));

  // Auto-stamp dates when status transitions, but don't overwrite values
  // the user has already set.
  useEffect(() => {
    if (status === "reading" && !startedAt) {
      setStartedAt(toDateInput(new Date().toISOString()));
    }
    if (status === "finished" && !finishedAt) {
      setFinishedAt(toDateInput(new Date().toISOString()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function handleSave() {
    onSave({
      status,
      rating,
      note: note.trim() ? note : undefined,
      startedAt: fromDateInput(startedAt),
      finishedAt: fromDateInput(finishedAt),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${book.title}`}
      >
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-start gap-3">
          {book.imageUrl ? (
            <img
              src={book.imageUrl}
              alt=""
              className="w-12 h-16 object-cover rounded flex-shrink-0 bg-gray-100 dark:bg-gray-700"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm text-gray-900 dark:text-white truncate">
              {book.title}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{book.author}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          <Field label="Status">
            <div className="flex flex-wrap gap-1.5">
              {SHELF_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    status === s
                      ? "bg-amber-600 border-amber-600 text-white"
                      : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                  }`}
                >
                  {statusLabel(s)}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Rating">
            <StarRating value={rating} onChange={setRating} size={24} />
          </Field>

          <Field label="Notes">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={5}
              placeholder="Private notes or a public review..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm placeholder-gray-400 resize-y"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Started">
              <input
                type="date"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              />
            </Field>
            <Field label="Finished">
              <input
                type="date"
                value={finishedAt}
                onChange={(e) => setFinishedAt(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              />
            </Field>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

function toDateInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function fromDateInput(date: string): string | undefined {
  if (!date) return undefined;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}
