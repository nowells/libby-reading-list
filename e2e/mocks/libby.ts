import type { Page, Route } from "@playwright/test";
import type { MockBook, MockLibrary } from "./types";

/**
 * Build a Libby Thunder API media item from our mock book shape. The
 * shape mirrors the real OverDrive payload so the app's parsing code
 * does not have to special-case test data.
 */
function toMediaItem(book: MockBook) {
  return {
    id: book.id,
    title: book.title,
    sortTitle: book.title.toLowerCase(),
    type: {
      id: book.formatType ?? "ebook",
      name: book.formatType === "audiobook" ? "Audiobook" : "eBook",
    },
    formats: [
      book.formatType === "audiobook"
        ? { id: "audiobook-overdrive", name: "OverDrive Listen" }
        : { id: "ebook-overdrive", name: "OverDrive Read" },
    ],
    creators: [{ name: book.author, role: "Author" }],
    covers: book.coverHref ? { cover150Wide: { href: book.coverHref } } : undefined,
    publisher: book.publisher ? { id: `pub-${book.id}`, name: book.publisher } : undefined,
    publishDate: book.publishDate,
    isAvailable: book.isAvailable ?? (book.availableCopies ?? 0) > 0,
    ownedCopies: book.ownedCopies ?? 0,
    availableCopies: book.availableCopies ?? 0,
    holdsCount: book.holdsCount ?? 0,
    estimatedWaitDays: book.estimatedWaitDays,
  };
}

function bookMatchesQuery(book: MockBook, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  if (book.isbn13 && q.replace(/\D/g, "") === book.isbn13) return true;
  return book.title.toLowerCase().includes(q) || book.author.toLowerCase().includes(q);
}

export interface LibbyMocks {
  /** All books in the catalog. Tests can mutate this between calls. */
  books: MockBook[];
  /** All libraries discoverable via the locate endpoint. */
  libraries: MockLibrary[];
}

export async function installLibbyRoutes(page: Page, mocks: LibbyMocks): Promise<void> {
  // /v2/libraries/{key}  → preferred key + name
  await page.route("https://thunder.api.overdrive.com/v2/libraries/*", async (route: Route) => {
    const url = new URL(route.request().url());
    // Skip nested paths — those are handled by the more specific routes below.
    if (url.pathname.split("/").length > 5) return route.fallback();
    const segments = url.pathname.split("/");
    const key = segments[segments.length - 1];
    const lib = mocks.libraries.find((l) => l.key === key);
    if (!lib) {
      return route.fulfill({ status: 404, body: "not found" });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        preferredKey: lib.preferredKey ?? lib.key,
        name: lib.name,
      }),
    });
  });

  // /v2/libraries/{key}/media  → search results
  await page.route(
    "https://thunder.api.overdrive.com/v2/libraries/*/media*",
    async (route: Route) => {
      const url = new URL(route.request().url());
      // Per-title detail endpoints are handled by the next route handler.
      if (url.pathname.match(/\/media\/[^/]+/)) return route.fallback();
      const query = url.searchParams.get("query") ?? "";
      const items = mocks.books.filter((b) => bookMatchesQuery(b, query)).map(toMediaItem);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items }),
      });
    },
  );

  // /v2/libraries/{key}/media/{titleId}  and /availability
  await page.route(
    "https://thunder.api.overdrive.com/v2/libraries/*/media/*",
    async (route: Route) => {
      const url = new URL(route.request().url());
      const segments = url.pathname.split("/");
      const isAvail = segments[segments.length - 1] === "availability";
      const titleId = isAvail ? segments[segments.length - 2] : segments[segments.length - 1];
      const book = mocks.books.find((b) => b.id === titleId);
      if (!book) {
        return route.fulfill({ status: 404, body: "not found" });
      }
      if (isAvail) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ownedCopies: book.ownedCopies ?? 0,
            copiesAvailable: book.availableCopies ?? 0,
            holdsCount: book.holdsCount ?? 0,
            isAvailable: book.isAvailable ?? (book.availableCopies ?? 0) > 0,
            estimatedWaitDays: book.estimatedWaitDays,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(toMediaItem(book)),
      });
    },
  );

  // locate.libbyapp.com/autocomplete/{query}  → library search
  await page.route("https://locate.libbyapp.com/autocomplete/*", async (route: Route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const query = decodeURIComponent(segments[segments.length - 1] ?? "");
    const q = query.toLowerCase();
    const matched = mocks.libraries.filter((l) => l.name.toLowerCase().includes(q));
    const systems = matched.map((lib, i) => ({
      id: i + 1,
      name: lib.name,
      fulfillmentId: lib.key,
      type: lib.type ?? "library",
      isConsortium: false,
      styling: lib.logoUrl ? { logos: [{ sourceUrl: lib.logoUrl }] } : undefined,
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        branches: [{ systems }],
      }),
    });
  });
}
