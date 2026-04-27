import { describe, it, expect, beforeEach } from "vitest";
import {
  searchAuthor,
  getAuthorWorks,
  resolveAuthorKey,
  getAuthorDetails,
} from "./openlibrary-author";
import { worker } from "~/test/setup";
import { http, HttpResponse } from "msw";

const olAuthorSearchResponse = {
  docs: [
    { key: "OL7313085A", name: "Adrian Tchaikovsky", work_count: 45, top_work: "Children of Time" },
    { key: "OL999999A", name: "Adrian Smith", work_count: 2 },
  ],
};

const olAuthorWorksResponse = {
  entries: [
    {
      title: "Children of Time",
      first_publish_date: "2015",
      key: "/works/OL17823492W",
      covers: [12345],
    },
    { title: "Children of Ruin", first_publish_date: "2019", key: "/works/OL20000000W" },
    { title: "Shards of Earth", first_publish_date: "2021", key: "/works/OL21000000W" },
  ],
};

describe("openlibrary-author", () => {
  beforeEach(() => {
    worker.use(
      http.get("https://openlibrary.org/search/authors.json", () => {
        return HttpResponse.json(olAuthorSearchResponse);
      }),
      http.get("https://openlibrary.org/authors/:authorKey/works.json", () => {
        return HttpResponse.json(olAuthorWorksResponse);
      }),
    );
  });

  describe("searchAuthor", () => {
    it("returns mapped author results", async () => {
      const results = await searchAuthor("Adrian Tchaikovsky");
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        key: "OL7313085A",
        name: "Adrian Tchaikovsky",
        workCount: 45,
        topWork: "Children of Time",
      });
    });

    it("returns empty array on HTTP error", async () => {
      worker.use(
        http.get("https://openlibrary.org/search/authors.json", () => {
          return new HttpResponse(null, { status: 500 });
        }),
      );
      const results = await searchAuthor("Nobody");
      expect(results).toEqual([]);
    });
  });

  describe("getAuthorWorks", () => {
    it("returns works sorted by year descending", async () => {
      const works = await getAuthorWorks("OL7313085A");
      expect(works).toHaveLength(3);
      expect(works[0].title).toBe("Shards of Earth");
      expect(works[1].title).toBe("Children of Ruin");
      expect(works[2].title).toBe("Children of Time");
    });

    it("extracts coverId from covers array", async () => {
      const works = await getAuthorWorks("OL7313085A");
      const cot = works.find((w) => w.title === "Children of Time");
      expect(cot?.coverId).toBe(12345);
    });

    it("caches results in localStorage", async () => {
      await getAuthorWorks("OL7313085A");
      const cached = localStorage.getItem("shelfcheck:ol-author:works:OL7313085A");
      expect(cached).toBeTruthy();
      const parsed = JSON.parse(cached!);
      expect(parsed.v).toHaveLength(3);
    });

    it("returns cached results on subsequent calls", async () => {
      await getAuthorWorks("OL7313085A");
      // Override handler to return empty - should still get cached data
      worker.use(
        http.get("https://openlibrary.org/authors/:authorKey/works.json", () => {
          return HttpResponse.json({ entries: [] });
        }),
      );
      const works = await getAuthorWorks("OL7313085A");
      expect(works).toHaveLength(3);
    });
  });

  describe("resolveAuthorKey", () => {
    it("returns best match for exact name", async () => {
      const result = await resolveAuthorKey("Adrian Tchaikovsky");
      expect(result).toEqual({ key: "OL7313085A", name: "Adrian Tchaikovsky" });
    });

    it("returns first result when no exact match", async () => {
      const result = await resolveAuthorKey("Adrian");
      expect(result).toEqual({ key: "OL7313085A", name: "Adrian Tchaikovsky" });
    });

    it("returns null when no results", async () => {
      worker.use(
        http.get("https://openlibrary.org/search/authors.json", () => {
          return HttpResponse.json({ docs: [] });
        }),
      );
      const result = await resolveAuthorKey("Nobody At All");
      expect(result).toBeNull();
    });

    it("caches resolved author", async () => {
      await resolveAuthorKey("Adrian Tchaikovsky");
      const cached = localStorage.getItem("shelfcheck:ol-author:resolve:adrian tchaikovsky");
      expect(cached).toBeTruthy();
    });
  });

  describe("getAuthorDetails", () => {
    beforeEach(() => {
      worker.use(
        http.get("https://openlibrary.org/authors/:authorKey.json", () =>
          HttpResponse.json({
            key: "/authors/OL7313085A",
            name: "Adrian Tchaikovsky",
            bio: { type: "/type/text", value: "British author of speculative fiction." },
            birth_date: "14 June 1972",
            alternate_names: ["Adrian Czajkowski"],
            photos: [9000001],
            links: [{ title: "Homepage", url: "https://shadowsoftheapt.com" }],
            wikipedia: "https://en.wikipedia.org/wiki/Adrian_Tchaikovsky",
          }),
        ),
      );
    });

    it("returns null for invalid keys", async () => {
      expect(await getAuthorDetails("not-a-key")).toBeNull();
    });

    it("normalizes the typed-text bio to a string", async () => {
      const d = await getAuthorDetails("OL7313085A");
      expect(typeof d?.bio).toBe("string");
      expect(d?.bio).toContain("British");
    });

    it("captures alternate names, birth date, photos, and wikipedia", async () => {
      const d = await getAuthorDetails("OL7313085A");
      expect(d?.alternateNames).toEqual(["Adrian Czajkowski"]);
      expect(d?.birthDate).toBe("14 June 1972");
      expect(d?.photoIds).toEqual([9000001]);
      expect(d?.wikipediaUrl).toContain("wikipedia");
    });

    it("caches the response", async () => {
      await getAuthorDetails("OL7313085A");
      const cached = localStorage.getItem("shelfcheck:ol-author-details:OL7313085A");
      expect(cached).toBeTruthy();
    });

    it("returns null on API error", async () => {
      worker.use(
        http.get("https://openlibrary.org/authors/:authorKey.json", () =>
          HttpResponse.json({}, { status: 500 }),
        ),
      );
      expect(await getAuthorDetails("OL999999A")).toBeNull();
    });
  });
});
