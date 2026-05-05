import { useEffect } from "react";
import type { Book } from "~/lib/storage";
import { updateBadgeCount, checkAndNotifyAvailabilityChanges } from "~/lib/notifications";
import { categorizeBook, type BookAvailState } from "../lib/categorize";

/**
 * Watches the availability map and triggers badge updates + notifications
 * when books transition from unavailable → available.
 */
export function useAvailabilityNotifications(
  books: Book[],
  availMap: Record<string, BookAvailState>,
  checkedCount: number,
  totalBooks: number,
) {
  useEffect(() => {
    // Only run after initial check is substantially complete (>50% checked)
    if (totalBooks === 0 || checkedCount < totalBooks * 0.5) return;

    const currentAvailability: Record<string, boolean> = {};
    const titleMap: Record<string, string> = {};
    let availableCount = 0;

    for (const book of books) {
      const state = availMap[book.id];
      const isAvailable = categorizeBook(state) === "available";
      currentAvailability[book.id] = isAvailable;
      titleMap[book.id] = book.title;
      if (isAvailable) availableCount++;
    }

    // Update badge count
    updateBadgeCount(availableCount);

    // Check for state transitions and notify
    checkAndNotifyAvailabilityChanges(currentAvailability, titleMap);
  }, [books, availMap, checkedCount, totalBooks]);
}
