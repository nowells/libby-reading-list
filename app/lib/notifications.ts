import {
  getNotificationSettings,
  getPreviousAvailabilityState,
  setPreviousAvailabilityState,
} from "./storage";

/**
 * Update the app badge count with the number of currently available books.
 * Uses the Badging API (navigator.setAppBadge) when available.
 */
export function updateBadgeCount(availableCount: number) {
  const settings = getNotificationSettings();
  if (!settings.badgeEnabled) {
    clearBadge();
    return;
  }

  if ("setAppBadge" in navigator) {
    if (availableCount > 0) {
      navigator.setAppBadge(availableCount);
    } else {
      navigator.clearAppBadge();
    }
  }
}

export function clearBadge() {
  if ("clearAppBadge" in navigator) {
    navigator.clearAppBadge();
  }
}

/**
 * Compare current availability state against previous state.
 * Notifies about books that transitioned from unavailable → available.
 * Returns the list of newly available book titles (for testing).
 */
export function checkAndNotifyAvailabilityChanges(
  currentAvailability: Record<string, boolean>,
  bookTitleMap: Record<string, string>,
): string[] {
  const settings = getNotificationSettings();
  if (!settings.enabled) {
    // Still persist state so when notifications are enabled later,
    // we have a baseline and don't spam.
    setPreviousAvailabilityState(currentAvailability);
    return [];
  }

  const previousState = getPreviousAvailabilityState();

  // Find books that switched from not-available (false or absent) to available (true)
  const newlyAvailable: string[] = [];
  for (const [bookId, isAvailable] of Object.entries(currentAvailability)) {
    if (isAvailable && !previousState[bookId]) {
      newlyAvailable.push(bookId);
    }
  }

  // Persist current state for next comparison
  setPreviousAvailabilityState(currentAvailability);

  if (newlyAvailable.length === 0) return [];

  const titles = newlyAvailable.map((id) => bookTitleMap[id] ?? "Unknown title");
  sendNotification(titles);
  return titles;
}

function sendNotification(titles: string[]) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const count = titles.length;
  const title =
    count === 1 ? `${titles[0]} is now available!` : `${count} books are now available!`;
  const body =
    count === 1
      ? "Head to your library app to borrow it."
      : titles.slice(0, 3).join(", ") + (count > 3 ? ` and ${count - 3} more` : "");

  // Use service worker registration for push-style notifications (persist after tab close)
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(title, {
        body,
        icon: "/apple-touch-icon.png",
        badge: "/favicon-48x48.png",
        tag: "availability-update",
        renotify: true,
      } as NotificationOptions);
    });
  } else {
    // Fallback: basic browser notification (side-effect is intentional)
    // oxlint-disable-next-line no-new
    new Notification(title, {
      body,
      icon: "/apple-touch-icon.png",
      tag: "availability-update",
    });
  }
}

/** Request notification permission. Returns true if granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const result = await Notification.requestPermission();
  return result === "granted";
}

/** Check if notifications are supported and permission is not denied. */
export function canRequestNotifications(): boolean {
  return "Notification" in window && Notification.permission !== "denied";
}

/** Get current notification permission state. */
export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}
