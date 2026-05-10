import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { worker } from "~/test/setup";
import {
  contentWordsMatch,
  searchLibrary,
  getLibraryPreferredKey,
  searchLibraryByName,
  findBookInLibrary,
  REFERENCE_LIBRARY,
} from "./libby";

// ---------------------------------------------------------------------------
// contentWordsMatch (existing tests)
// ---------------------------------------------------------------------------
describe("contentWordsMatch", () => {
  it("rejects sibling-series titles that only share the series word", () => {
    expect(contentWordsMatch("Children of Time", "Children of Ruin")).toBe(false);
    expect(contentWordsMatch("Children of Time", "Children of Strife")).toBe(false);
  });

  it("accepts the exact same title", () => {
    expect(contentWordsMatch("Children of Time", "Children of Time")).toBe(true);
  });

  it("accepts a title with extra words around the search words", () => {
    expect(contentWordsMatch("Children of Time", "Children of Time: A Novel")).toBe(true);
    expect(
      contentWordsMatch("Children of Time", "Children of Time (Children of Time series, book 1)"),
    ).toBe(true);
  });

  it("ignores stop words like 'of', 'the', 'and'", () => {
    expect(contentWordsMatch("The Great Gatsby", "Great Gatsby")).toBe(true);
  });

  it("normalizes punctuation and case", () => {
    expect(contentWordsMatch("Foundation, Vol. 1", "foundation vol 1")).toBe(true);
    expect(contentWordsMatch("DUNE", "dune")).toBe(true);
  });

  it("returns true when the search has no content words", () => {
    expect(contentWordsMatch("the of and", "anything")).toBe(true);
  });

  it("rejects when even one content word is missing from the result", () => {
    expect(contentWordsMatch("The Two Towers", "Towers of Midnight")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helper: create a media item for MSW responses
// ---------------------------------------------------------------------------
function makeMediaItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "media-1",
    title: "Children of Time",
    sortTitle: "children of time",
    type: { id: "ebook", name: "eBook" },
    formats: [{ id: "ebook-overdrive", name: "OverDrive Read" }],
    creators: [{ name: "Adrian Tchaikovsky", role: "Author" }],
    covers: { cover150Wide: { href: "https://example.com/cover.jpg" } },
    publisher: { id: "pub-1", name: "Pan Macmillan" },
    publishDate: "2015-06-04",
    isAvailable: true,
    ownedCopies: 5,
    availableCopies: 2,
    holdsCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// searchLibrary
// ---------------------------------------------------------------------------
describe("searchLibrary", () => {
  it("returns items from the default handler", async () => {
    const items = await searchLibrary("lapl", "Children of Time");
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Children of Time");
  });

  it("returns empty array when API returns no items", async () => {
    worker.use(
      http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
        return HttpResponse.json({ items: [] });
      }),
    );
    const items = await searchLibrary("lapl", "nonexistent");
    expect(items).toEqual([]);
  });

  it("returns empty array when API returns no items key", async () => {
    worker.use(
      http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
        return HttpResponse.json({});
      }),
    );
    const items = await searchLibrary("lapl", "anything");
    expect(items).toEqual([]);
  });

  it("includes format parameter for ebook filter", async () => {
    let capturedUrl = "";
    worker.use(
      http.get(
        "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media",
        ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ items: [] });
        },
      ),
    );
    await searchLibrary("lapl", "test query", "ebook");
    expect(capturedUrl).toContain("format=");
    expect(capturedUrl).toContain("ebook-kindle");
  });

  it("includes format parameter for audiobook filter", async () => {
    let capturedUrl = "";
    worker.use(
      http.get(
        "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media",
        ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ items: [] });
        },
      ),
    );
    await searchLibrary("lapl", "test query", "audiobook");
    expect(capturedUrl).toContain("format=");
    expect(capturedUrl).toContain("audiobook-overdrive");
  });

  it("throws on non-OK response", async () => {
    worker.use(
      http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
        return new HttpResponse(null, { status: 500, statusText: "Internal Server Error" });
      }),
    );
    await expect(searchLibrary("lapl", "test")).rejects.toThrow("Libby API error: 500");
  });

  it("walks pages until the response stops advertising a `next` page", async () => {
    // Real Libby query for a long series (Penny's Gamache) returns
    // `totalItems: 47` paginated as 24+23. Without walking the cursor
    // the series page on /book/<id> only saw the first 24 items and
    // half the books were missing.
    const pagesSeen: number[] = [];
    worker.use(
      http.get(
        "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media",
        ({ request }) => {
          const url = new URL(request.url);
          const page = parseInt(url.searchParams.get("page") ?? "1", 10);
          pagesSeen.push(page);
          if (page === 1) {
            return HttpResponse.json({
              items: [
                makeMediaItem({ id: "p1-a" }),
                makeMediaItem({ id: "p1-b" }),
                makeMediaItem({ id: "p1-c" }),
              ],
              totalItems: 5,
              links: { self: { page: 1 }, last: { page: 2 }, next: { page: 2 } },
            });
          }
          return HttpResponse.json({
            items: [makeMediaItem({ id: "p2-a" }), makeMediaItem({ id: "p2-b" })],
            totalItems: 5,
            links: { self: { page: 2 }, last: { page: 2 } },
          });
        },
      ),
    );
    const items = await searchLibrary("lapl", "Long Series");
    expect(pagesSeen).toEqual([1, 2]);
    expect(items.map((i) => i.id)).toEqual(["p1-a", "p1-b", "p1-c", "p2-a", "p2-b"]);
  });

  it("stops walking when the response has no `next` link", async () => {
    let calls = 0;
    worker.use(
      http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
        calls++;
        return HttpResponse.json({
          items: [makeMediaItem({ id: "only" })],
          totalItems: 1,
          links: { self: { page: 1 }, last: { page: 1 } },
        });
      }),
    );
    const items = await searchLibrary("lapl", "Short Series");
    expect(calls).toBe(1);
    expect(items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getLibraryPreferredKey
// ---------------------------------------------------------------------------
describe("getLibraryPreferredKey", () => {
  it("returns the preferredKey from the API", async () => {
    const key = await getLibraryPreferredKey("some-fulfillment-id");
    expect(key).toBe("lapl");
  });

  it("falls back to fulfillmentId when preferredKey is not present", async () => {
    worker.use(
      http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey", () => {
        return HttpResponse.json({ name: "Some Library" });
      }),
    );
    const key = await getLibraryPreferredKey("my-fulfillment-id");
    expect(key).toBe("my-fulfillment-id");
  });
});

// ---------------------------------------------------------------------------
// searchLibraryByName
// ---------------------------------------------------------------------------
describe("searchLibraryByName", () => {
  it("returns libraries from the locate API", async () => {
    const libraries = await searchLibraryByName("los angeles");
    expect(libraries).toHaveLength(1);
    expect(libraries[0].name).toBe("Los Angeles Public Library");
    expect(libraries[0].fulfillmentId).toBe("lapl");
    expect(libraries[0].logoUrl).toBe("https://example.com/lapl-logo.png");
  });

  it("deduplicates systems by id", async () => {
    worker.use(
      http.get("https://locate.libbyapp.com/autocomplete/:query", () => {
        return HttpResponse.json({
          branches: [
            {
              systems: [
                { id: 1, name: "Library A", fulfillmentId: "lib-a" },
                { id: 2, name: "Library B", fulfillmentId: "lib-b" },
              ],
            },
            {
              systems: [
                { id: 1, name: "Library A (dup)", fulfillmentId: "lib-a" },
                { id: 3, name: "Library C", fulfillmentId: "lib-c" },
              ],
            },
          ],
        });
      }),
    );
    const libraries = await searchLibraryByName("test");
    expect(libraries).toHaveLength(3);
    expect(libraries.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(libraries[0].name).toBe("Library A");
  });

  it("returns empty array when no branches", async () => {
    worker.use(
      http.get("https://locate.libbyapp.com/autocomplete/:query", () => {
        return HttpResponse.json({});
      }),
    );
    const libraries = await searchLibraryByName("nonexistent");
    expect(libraries).toEqual([]);
  });

  it("throws on non-OK response", async () => {
    worker.use(
      http.get("https://locate.libbyapp.com/autocomplete/:query", () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );
    await expect(searchLibraryByName("test")).rejects.toThrow("Libby locate API error: 500");
  });
});

// ---------------------------------------------------------------------------
// findBookInLibrary
// ---------------------------------------------------------------------------
describe("findBookInLibrary", () => {
  describe("Phase 1a: primary ISBN search", () => {
    it("finds a book by primary ISBN", async () => {
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].matchScore).toBe(1);
      expect(result.results[0].mediaItem.title).toBe("Children of Time");
      expect(result.bookTitle).toBe("Children of Time");
    });

    it("deduplicates ISBN results by id", async () => {
      worker.use(
        http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
          return HttpResponse.json({
            items: [
              makeMediaItem({ id: "media-1" }),
              makeMediaItem({ id: "media-1" }),
              makeMediaItem({ id: "media-2" }),
            ],
          });
        }),
      );
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
      });
      expect(result.results).toHaveLength(2);
    });

    it("takes at most 3 items from ISBN search", async () => {
      // Return 5 items only for the ISBN query; the text-search backfill
      // phase that runs after ISBN now (see "backfills the audiobook
      // edition…" test below) needs an empty response or it would push
      // the count past the cap.
      worker.use(
        http.get(
          "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media",
          ({ request }) => {
            const url = new URL(request.url);
            const query = url.searchParams.get("query") ?? "";
            if (query !== "9780316452502") return HttpResponse.json({ items: [] });
            return HttpResponse.json({
              items: [
                makeMediaItem({ id: "m-1" }),
                makeMediaItem({ id: "m-2" }),
                makeMediaItem({ id: "m-3" }),
                makeMediaItem({ id: "m-4" }),
                makeMediaItem({ id: "m-5" }),
              ],
            });
          },
        ),
      );
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
      });
      expect(result.results).toHaveLength(3);
    });
  });

  describe("Phase 1b: alternate ISBNs", () => {
    it("tries alternate ISBNs when primary ISBN finds nothing", async () => {
      let callCount = 0;
      worker.use(
        http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
          callCount++;
          if (callCount <= 1) {
            return HttpResponse.json({ items: [] });
          }
          return HttpResponse.json({ items: [makeMediaItem({ id: "alt-hit" })] });
        }),
      );
      const getAlternateIsbns = vi.fn(async () => ["alt-isbn-1"]);
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
        getAlternateIsbns,
      });
      expect(getAlternateIsbns).toHaveBeenCalledOnce();
      expect(result.results).toHaveLength(1);
    });

    it("skips alternate ISBNs when primary ISBN found results", async () => {
      const getAlternateIsbns = vi.fn(async () => ["alt-isbn-1"]);
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
        getAlternateIsbns,
      });
      expect(getAlternateIsbns).not.toHaveBeenCalled();
      expect(result.results.length).toBeGreaterThan(0);
    });

    it("backfills the audiobook edition via text search after the primary ISBN finds only the ebook", async () => {
      // Real-world bug: OverDrive assigns a separate ISBN to each format,
      // so a book whose stored isbn13 is its ebook ISBN was rendering on
      // /books with only the ebook ETA — even though the audiobook was
      // sitting right there at the same library, and the book details
      // page (which falls back to text search) showed both formats.
      // After the ISBN phase, the text-search phase has to run too so
      // the audiobook gets picked up as a same-title match.
      worker.use(
        http.get(
          "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media",
          ({ request }) => {
            const url = new URL(request.url);
            const query = url.searchParams.get("query") ?? "";
            // ISBN query: return only the ebook edition keyed to that ISBN.
            if (query === "9780316452502") {
              return HttpResponse.json({
                items: [
                  makeMediaItem({
                    id: "ebook-id",
                    type: { id: "ebook", name: "eBook" },
                  }),
                ],
              });
            }
            // Title-based query: returns both editions.
            return HttpResponse.json({
              items: [
                makeMediaItem({ id: "ebook-id", type: { id: "ebook", name: "eBook" } }),
                makeMediaItem({
                  id: "audio-id",
                  type: { id: "audiobook", name: "Audiobook" },
                }),
              ],
            });
          },
        ),
      );
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
      });
      const formats = new Set(result.results.map((r) => r.formatType));
      expect(formats.has("ebook")).toBe(true);
      expect(formats.has("audiobook")).toBe(true);
      // Both editions should appear exactly once — seenIds dedup must
      // skip the ebook the ISBN phase already added.
      expect(result.results.filter((r) => r.mediaItem.id === "ebook-id")).toHaveLength(1);
    });

    it("handles alternate ISBN resolver failure gracefully", async () => {
      worker.use(
        http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
          return HttpResponse.json({ items: [] });
        }),
      );
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "primary",
        getAlternateIsbns: async () => {
          throw new Error("OL is down");
        },
      });
      expect(result).toBeDefined();
      expect(result.bookTitle).toBe("Children of Time");
    });
  });

  describe("Phase 2: text search", () => {
    it("falls back to text search when no ISBN provided", async () => {
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky");
      expect(result.results).toHaveLength(1);
      expect(result.results[0].mediaItem.title).toBe("Children of Time");
    });

    it("uses similarity scoring to filter bad matches", async () => {
      worker.use(
        http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
          return HttpResponse.json({
            items: [
              makeMediaItem({
                id: "good-match",
                title: "Children of Time",
                creators: [{ name: "Adrian Tchaikovsky", role: "Author" }],
              }),
              makeMediaItem({
                id: "bad-match",
                title: "Totally Different Book",
                creators: [{ name: "Someone Else", role: "Author" }],
              }),
            ],
          });
        }),
      );
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky");
      expect(result.results).toHaveLength(1);
      expect(result.results[0].mediaItem.id).toBe("good-match");
    });

    it("rejects series siblings via contentWordsMatch", async () => {
      worker.use(
        http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
          return HttpResponse.json({
            items: [
              makeMediaItem({
                id: "ruin",
                title: "Children of Ruin",
                creators: [{ name: "Adrian Tchaikovsky", role: "Author" }],
              }),
            ],
          });
        }),
      );
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky");
      expect(result.results).toHaveLength(0);
    });

    it("tries subtitle-stripped query for titles with colons", async () => {
      const searchQueries: string[] = [];
      worker.use(
        http.get(
          "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media",
          ({ request }) => {
            const url = new URL(request.url);
            searchQueries.push(url.searchParams.get("query") ?? "");
            return HttpResponse.json({ items: [] });
          },
        ),
      );
      await findBookInLibrary(
        REFERENCE_LIBRARY,
        "The Name of the Wind: The Kingkiller Chronicle",
        "Patrick Rothfuss",
      );
      expect(searchQueries).toContain("Patrick Rothfuss The Name of the Wind");
    });

    it("stops trying queries once results are found", async () => {
      let callCount = 0;
      worker.use(
        http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
          callCount++;
          return HttpResponse.json({ items: [makeMediaItem()] });
        }),
      );
      await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky");
      expect(callCount).toBe(1);
    });

    it("handles items with no creators", async () => {
      worker.use(
        http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
          return HttpResponse.json({
            items: [makeMediaItem({ id: "no-author", creators: [] })],
          });
        }),
      );
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky");
      expect(result).toBeDefined();
    });
  });

  describe("Phase 3: reference library deep search", () => {
    it("falls back to reference library when local search finds nothing", async () => {
      const requestedLibraries: string[] = [];
      worker.use(
        http.get(
          "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media",
          ({ params }) => {
            const lib = params.libraryKey as string;
            requestedLibraries.push(lib);
            if (lib === REFERENCE_LIBRARY) {
              return HttpResponse.json({ items: [makeMediaItem({ id: "ref-hit" })] });
            }
            return HttpResponse.json({ items: [] });
          },
        ),
        http.get(
          "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media/:titleId",
          () => {
            return HttpResponse.json(makeMediaItem({ id: "ref-hit" }));
          },
        ),
      );
      const result = await findBookInLibrary(
        "my-library",
        "Children of Time",
        "Adrian Tchaikovsky",
      );
      expect(requestedLibraries).toContain(REFERENCE_LIBRARY);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].libraryKey).toBe("my-library");
    });

    it("skips reference library when libraryKey is already reference", async () => {
      worker.use(
        http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
          return HttpResponse.json({ items: [] });
        }),
      );
      const result = await findBookInLibrary(REFERENCE_LIBRARY, "Nonexistent Book", "Nobody");
      expect(result.results).toHaveLength(0);
    });

    it("skips item if getMediaItem returns null (404)", async () => {
      worker.use(
        http.get(
          "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media",
          ({ params }) => {
            if ((params.libraryKey as string) === REFERENCE_LIBRARY) {
              return HttpResponse.json({ items: [makeMediaItem({ id: "ref-only" })] });
            }
            return HttpResponse.json({ items: [] });
          },
        ),
        http.get(
          "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media/:titleId",
          () => {
            return new HttpResponse(null, { status: 404 });
          },
        ),
      );
      const result = await findBookInLibrary(
        "my-library",
        "Children of Time",
        "Adrian Tchaikovsky",
      );
      expect(result.results).toHaveLength(0);
    });
  });

  describe("live availability refresh", () => {
    it("replaces search-embedded availability with live data", async () => {
      worker.use(
        http.get(
          "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media/:titleId/availability",
          () => {
            return HttpResponse.json({
              ownedCopies: 10,
              availableCopies: 7,
              holdsCount: 3,
              isAvailable: true,
            });
          },
        ),
      );
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
        liveAvailability: true,
      });
      expect(result.results[0].availability.copiesOwned).toBe(10);
      expect(result.results[0].availability.copiesAvailable).toBe(7);
    });

    it("keeps search-embedded availability if live fetch fails", async () => {
      worker.use(
        http.get(
          "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media/:titleId/availability",
          () => {
            return new HttpResponse(null, { status: 500 });
          },
        ),
      );
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
        liveAvailability: true,
      });
      // Should still have the search-embedded availability
      expect(result.results[0].availability.copiesOwned).toBe(5);
    });
  });

  describe("cover and series extraction", () => {
    it("extracts cover URL from best result", async () => {
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
      });
      expect(result.coverUrl).toBe("https://example.com/cover.jpg");
    });

    it("extracts series info from results", async () => {
      worker.use(
        http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
          return HttpResponse.json({
            items: [
              makeMediaItem({
                detailedSeries: {
                  seriesName: "Children of Time",
                  readingOrder: "1",
                },
              }),
            ],
          });
        }),
      );
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
      });
      expect(result.seriesInfo).toEqual({
        seriesName: "Children of Time",
        readingOrder: "1",
      });
    });

    it("returns no cover or series when results have none", async () => {
      worker.use(
        http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
          return HttpResponse.json({
            items: [makeMediaItem({ covers: undefined, detailedSeries: undefined })],
          });
        }),
      );
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
      });
      expect(result.coverUrl).toBeUndefined();
      expect(result.seriesInfo).toBeUndefined();
    });
  });

  describe("availability extraction", () => {
    it("computes availability from media item fields", async () => {
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
      });
      const avail = result.results[0].availability;
      expect(avail.id).toBe("media-1");
      expect(avail.copiesOwned).toBe(5);
      expect(avail.copiesAvailable).toBe(2);
      expect(avail.numberOfHolds).toBe(0);
      expect(avail.isAvailable).toBe(true);
    });

    it("defaults missing availability fields to 0", async () => {
      worker.use(
        http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
          return HttpResponse.json({
            items: [
              makeMediaItem({
                ownedCopies: undefined,
                availableCopies: undefined,
                holdsCount: undefined,
                isAvailable: undefined,
              }),
            ],
          });
        }),
      );
      const result = await findBookInLibrary("lapl", "Children of Time", "Adrian Tchaikovsky", {
        primaryIsbn: "9780316452502",
      });
      const avail = result.results[0].availability;
      expect(avail.copiesOwned).toBe(0);
      expect(avail.copiesAvailable).toBe(0);
      expect(avail.numberOfHolds).toBe(0);
      expect(avail.isAvailable).toBe(false);
    });
  });
});
