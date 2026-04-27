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

  // /search.json?q=...  → title+author resolution OR series roll-ups
  // ('series:"Children of Time"').
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

    // Series search: q = `series:"<name>"`
    const seriesMatch = q.match(/^series:"([^"]+)"\s*$/);
    if (seriesMatch) {
      const series = seriesMatch[1];
      const seriesDocs = mocks.books
        .filter((b) => b.workId && b.seriesName?.toLowerCase() === series)
        .map((b) => ({
          key: `/works/${b.workId}`,
          title: b.title,
          author_name: [b.author],
          first_publish_year: b.firstPublishYear,
          cover_i: b.coverId,
        }));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ docs: seriesDocs }),
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
        first_publish_year: b.firstPublishYear,
        cover_i: b.coverId,
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

  // /works/{id}.json → full work record (subjects, description, authors, links)
  await page.route("https://openlibrary.org/works/*", async (route: Route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const last = segments[segments.length - 1] ?? "";
    // Anything nested below /works/{id}/ is handled by the more specific
    // routes registered above (or below, when added).
    if (last === "editions.json" || last === "ratings.json") return route.fallback();
    const workId = last.replace(/\.json$/, "");
    const book = mocks.books.find((b) => b.workId === workId);
    if (!book) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ subjects: [] }),
      });
    }
    const author = mocks.authors.find((a) => a.key === book.olAuthorKey);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        title: book.title,
        subjects: book.subjects ?? [],
        first_publish_date: book.firstPublishYear ? String(book.firstPublishYear) : undefined,
        covers: book.coverId ? [book.coverId] : [],
        description: book.description ? { type: "/type/text", value: book.description } : undefined,
        authors: author ? [{ author: { key: `/authors/${author.key}` } }] : [],
        links: [],
      }),
    });
  });

  // /works/{id}/ratings.json
  await page.route("https://openlibrary.org/works/*/ratings.json*", async (route: Route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const workId = segments[segments.length - 2] ?? "";
    const book = mocks.books.find((b) => b.workId === workId);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: {
          average: book?.ratingAverage,
          count: book?.ratingCount ?? 0,
        },
        counts: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
      }),
    });
  });

  // /works/{id}/editions.json — used by both the ISBN enricher and the new
  // edition summary panel on the book detail page.
  await page.route("https://openlibrary.org/works/*/editions.json*", async (route: Route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const workId = segments[segments.length - 2] ?? "";
    const book = mocks.books.find((b) => b.workId === workId);
    if (!book) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries: [] }),
      });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: [
          {
            isbn_13: book.isbn13 ? [book.isbn13] : [],
            isbn_10: [],
            publishers: book.publisher ? [book.publisher] : [],
            publish_date: book.publishDate,
            number_of_pages: 480,
            languages: [{ key: "/languages/eng" }],
          },
        ],
      }),
    });
  });

  // /authors/{key}.json — author bio + photos for the author detail page.
  await page.route("https://openlibrary.org/authors/*", async (route: Route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const last = segments[segments.length - 1] ?? "";
    // Skip nested paths like /authors/{key}/works.json — handled below.
    if (last === "works.json" || last.endsWith("works.json")) return route.fallback();
    const authorKey = last.replace(/\.json$/, "");
    const author = mocks.authors.find((a) => a.key === authorKey);
    if (!author) {
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "not found" }),
      });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: `/authors/${author.key}`,
        name: author.name,
        bio: author.bio ? { type: "/type/text", value: author.bio } : undefined,
        birth_date: author.birthDate,
        death_date: author.deathDate,
        alternate_names: author.alternateNames ?? [],
        photos: [],
        links: [],
        wikipedia: author.wikipediaUrl,
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
