import type { Page, Route } from "@playwright/test";
import type { MockAuthor, MockBook } from "./types";

export interface OpenLibraryMocks {
  books: MockBook[];
  authors: MockAuthor[];
}

export async function installOpenLibraryRoutes(page: Page, mocks: OpenLibraryMocks): Promise<void> {
  // /isbn/<isbn>.json → minimal edition record carrying a /works/<workId> reference
  await page.route("https://openlibrary.org/isbn/*", async (route: Route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const last = segments[segments.length - 1] ?? "";
    const isbn = last.replace(/\.json$/, "");
    const book = mocks.books.find((b) => b.isbn13 === isbn);
    if (!book?.workId) {
      return route.fulfill({ status: 404, body: "not found" });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        title: book.title,
        works: [{ key: `/works/${book.workId}` }],
        isbn_13: book.isbn13 ? [book.isbn13] : [],
      }),
    });
  });

  // /search.json?q=...  → title+author resolution
  await page.route("https://openlibrary.org/search.json*", async (route: Route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    if (!q) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ docs: [] }),
      });
    }
    const matches = mocks.books
      .filter((b) => b.workId)
      .filter((b) => {
        const title = b.title.toLowerCase();
        const lastName = b.author.toLowerCase().split(/\s+/).pop() ?? "";
        return q.includes(title) || (q.includes(lastName) && q.includes(title.split(" ")[0]));
      })
      .slice(0, 5)
      .map((b) => ({
        key: `/works/${b.workId}`,
        title: b.title,
        author_name: [b.author],
        isbn: b.isbn13 ? [b.isbn13] : [],
      }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ docs: matches }),
    });
  });

  // /search/authors.json → author search
  await page.route("https://openlibrary.org/search/authors.json*", async (route: Route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const matched = mocks.authors.filter((a) => a.name.toLowerCase().includes(q));
    const docs = matched.map((a) => ({
      key: a.key,
      name: a.name,
      work_count: a.workCount ?? a.works?.length ?? 0,
      top_work: a.topWork,
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ docs }),
    });
  });

  // /works/{id}.json → work metadata (subjects + first publish year)
  await page.route("https://openlibrary.org/works/*", async (route: Route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const last = segments[segments.length - 1] ?? "";
    if (last === "editions.json" || last.endsWith("editions.json")) return route.fallback();
    const workId = last.replace(/\.json$/, "");
    const book = mocks.books.find((b) => b.workId === workId);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subjects: book?.subjects ?? [],
        first_publish_date: book?.firstPublishYear ? String(book.firstPublishYear) : undefined,
      }),
    });
  });

  // /works/{id}/editions.json
  await page.route("https://openlibrary.org/works/*/editions.json*", async (route: Route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const workId = segments[segments.length - 2] ?? "";
    const book = mocks.books.find((b) => b.workId === workId);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: book?.isbn13 ? [{ isbn_13: [book.isbn13], isbn_10: [] }] : [],
      }),
    });
  });

  // /authors/{key}/works.json → all works for an author
  await page.route("https://openlibrary.org/authors/*/works.json*", async (route: Route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const authorKey = segments[segments.length - 2] ?? "";
    const author = mocks.authors.find((a) => a.key === authorKey);
    const entries = (author?.works ?? []).map((w) => ({
      title: w.title,
      first_publish_date: w.firstPublishYear ? String(w.firstPublishYear) : undefined,
      key: `/works/${w.workId}`,
      covers: [],
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries }),
    });
  });
}
