import type { Page, Route } from "@playwright/test";
import { fixtureAuthors, fixtureBooks, fixtureLibraries, TINY_PNG_BASE64 } from "./catalog";
import { installLibbyRoutes } from "./libby";
import { installOpenLibraryRoutes } from "./openlibrary";
import { installPdsRoutes, MockPds } from "./pds";
import { installOAuthHook, type FakeBlueskyAccount } from "./oauth";
import type { MockAuthor, MockBook, MockLibrary } from "./types";

export interface InstallMocksOptions {
  /** Override / extend the catalog of books returned by Libby + Open Library. */
  books?: MockBook[];
  /** Library catalog the locate endpoint searches over. */
  libraries?: MockLibrary[];
  /** Authors visible to /search/authors.json + /authors/{key}/works.json. */
  authors?: MockAuthor[];
  /** Bluesky accounts the test OAuth hook will accept. */
  blueskyAccounts?: FakeBlueskyAccount[];
}

export interface InstalledMocks {
  pds: MockPds;
  books: MockBook[];
  libraries: MockLibrary[];
  authors: MockAuthor[];
}

/**
 * One-stop install for every external dependency the app touches.
 * Tests should call this in a `beforeEach` so each spec starts from a
 * clean slate. The returned `pds` lets tests preload PDS records
 * (simulating data that was synced on a different device).
 */
export async function installMocks(
  page: Page,
  opts: InstallMocksOptions = {},
): Promise<InstalledMocks> {
  const books = opts.books ?? fixtureBooks;
  const libraries = opts.libraries ?? fixtureLibraries;
  const authors = opts.authors ?? fixtureAuthors;

  const pds = new MockPds();

  // Block the real PostHog + handle resolver endpoints up-front so they
  // don't drift across test boundaries when the dev server proxies them.
  await page.route(/https:\/\/.*posthog\.com\/.*/, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route(/https:\/\/public\.api\.bsky\.app\/.*/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ actors: [] }),
    }),
  );
  // Cover images: any URL that ends in a .jpg / .png we redirect to a
  // tiny in-memory PNG so layouts don't depend on real cover servers.
  const coverPng = Buffer.from(TINY_PNG_BASE64, "base64");
  await page.route(/^https:\/\/example\.test\/.*\.(?:jpg|png)$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: coverPng }),
  );
  await page.route(/^https:\/\/covers\.openlibrary\.org\/.*/, (route: Route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: coverPng }),
  );

  await installLibbyRoutes(page, { books, libraries });
  await installOpenLibraryRoutes(page, { books, authors });
  await installPdsRoutes(page, pds);
  await installOAuthHook(page, opts.blueskyAccounts ?? []);

  return { pds, books, libraries, authors };
}

export { MockPds } from "./pds";
export type { FakeBlueskyAccount } from "./oauth";
export type { MockAuthor, MockBook, MockLibrary } from "./types";
export { fixtureAuthors, fixtureBooks, fixtureLibraries } from "./catalog";
