import { matchPath } from "react-router";

// Keep in sync with app/routes.ts. Used to normalize PostHog pageview
// pathnames so dynamic routes report as patterns (e.g. "/book/:workId")
// instead of concrete URLs (e.g. "/book/OL12345W").
const ROUTE_PATTERNS = [
  "/",
  "/setup",
  "/books",
  "/authors",
  "/author/:authorKey",
  "/book/:workId",
  "/shelf",
  "/friends",
  "/friends/:handle",
  "/stats",
] as const;

export function normalizePathname(pathname: string): string | null {
  for (const pattern of ROUTE_PATTERNS) {
    if (matchPath(pattern, pathname)) {
      return pattern;
    }
  }
  return null;
}

type CaptureLike = {
  event?: string;
  properties?: Record<string, unknown>;
} | null;

const URL_PROPS = ["$current_url", "$prev_pageview_url", "$referrer"] as const;
const PATH_PROPS = ["$pathname", "$prev_pageview_pathname"] as const;

function rewriteUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const pattern = normalizePathname(url.pathname);
    if (!pattern) return undefined;
    url.pathname = pattern;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function posthogBeforeSend<T extends CaptureLike>(event: T): T {
  if (!event || !event.properties) return event;
  const props = event.properties;

  for (const key of PATH_PROPS) {
    const value = props[key];
    if (typeof value === "string") {
      const pattern = normalizePathname(value);
      if (pattern) props[key] = pattern;
    }
  }

  for (const key of URL_PROPS) {
    const rewritten = rewriteUrl(props[key]);
    if (rewritten) props[key] = rewritten;
  }

  return event;
}
