import type { BookAvailability } from "~/lib/libby";

export const SOON_THRESHOLD_DAYS = 14;

export type BookCategory = "available" | "soon" | "waiting" | "not_found" | "pending";

export type AvailStatus = "cached" | "pending" | "loading" | "done";

export interface BookAvailState {
  status: AvailStatus;
  data?: BookAvailability;
  fetchedAt?: number;
}

export type FormatFilter = "all" | "ebook" | "audiobook";

function categorizeBook(state?: BookAvailState): BookCategory {
  if (!state || state.status === "pending") return "pending";
  if (state.status === "loading" && !state.data) return "pending";
  if (!state.data || state.data.results.length === 0) return "not_found";
  if (state.data.results.some((r) => r.availability.isAvailable)) return "available";
  const minWait = Math.min(
    ...state.data.results
      .map((r) => r.availability.estimatedWaitDays ?? Infinity)
  );
  if (minWait <= SOON_THRESHOLD_DAYS) return "soon";
  return "waiting";
}

export function categorizeBookWithFormat(state: BookAvailState | undefined, formatFilter: FormatFilter): BookCategory {
  if (!state || state.status === "pending") return "pending";
  if (state.status === "loading" && !state.data) return "pending";
  const results = formatFilter === "all"
    ? (state.data?.results ?? [])
    : (state.data?.results ?? []).filter((r) => r.formatType === formatFilter);
  if (results.length === 0) return "not_found";
  if (results.some((r) => r.availability.isAvailable)) return "available";
  const minWait = Math.min(...results.map((r) => r.availability.estimatedWaitDays ?? Infinity));
  if (minWait <= SOON_THRESHOLD_DAYS) return "soon";
  return "waiting";
}

export function categoryScore(cat: BookCategory): number {
  switch (cat) {
    case "available": return 4;
    case "soon": return 3;
    case "waiting": return 2;
    case "not_found": return 1;
    default: return 0;
  }
}
