import type { Book, ShelfStatus } from "~/lib/storage";

const STATUS_LABELS: Record<ShelfStatus, string> = {
  wantToRead: "Want to read",
  reading: "Reading",
  finished: "Finished",
  abandoned: "Abandoned",
};

const STATUS_CLASSES: Record<ShelfStatus, string> = {
  wantToRead:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  reading:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  finished:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800",
  abandoned:
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700",
};

export const SHELF_STATUSES: ShelfStatus[] = ["wantToRead", "reading", "finished", "abandoned"];

export function statusLabel(status: ShelfStatus): string {
  return STATUS_LABELS[status];
}

export function effectiveStatus(book: Book): ShelfStatus {
  return book.status ?? "wantToRead";
}

export function StatusPill({ status }: { status: ShelfStatus }) {
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
