import { describe, it, expect } from "vitest";
import { hasImportedFromBookHive, getLastPdsSync, searchHandleSuggestions } from "./atproto";
import { worker } from "~/test/setup";
import { http, HttpResponse } from "msw";

const TEST_DID = "did:plc:testuser";

describe("atproto", () => {
  describe("hasImportedFromBookHive", () => {
    it("returns false when no flag is stored for the DID", () => {
      expect(hasImportedFromBookHive(TEST_DID)).toBe(false);
    });

    it("is keyed by DID so different accounts stay independent", () => {
      localStorage.setItem(`shelfcheck:bookhive-imported:${TEST_DID}`, new Date().toISOString());
      expect(hasImportedFromBookHive(TEST_DID)).toBe(true);
      expect(hasImportedFromBookHive("did:plc:someoneelse")).toBe(false);
    });
  });

  describe("getLastPdsSync", () => {
    it("returns null when no sync has happened for the DID", () => {
      expect(getLastPdsSync(TEST_DID)).toBeNull();
    });

    it("returns the stored timestamp", () => {
      const stamp = new Date().toISOString();
      localStorage.setItem(`shelfcheck:pds-last-sync:${TEST_DID}`, stamp);
      expect(getLastPdsSync(TEST_DID)).toBe(stamp);
    });
  });

  describe("searchHandleSuggestions", () => {
    it("returns empty for blank query", async () => {
      const results = await searchHandleSuggestions("");
      expect(results).toEqual([]);
    });

    it("returns empty for whitespace-only query", async () => {
      const results = await searchHandleSuggestions("   ");
      expect(results).toEqual([]);
    });

    it("returns actors from API response", async () => {
      const mockActors = [
        {
          did: "did:plc:abc",
          handle: "alice.bsky.social",
          displayName: "Alice",
          avatar: "https://example.com/avatar.jpg",
        },
        { did: "did:plc:def", handle: "bob.bsky.social" },
      ];

      worker.use(
        http.get("https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead", () => {
          return HttpResponse.json({ actors: mockActors });
        }),
      );

      const results = await searchHandleSuggestions("ali");
      expect(results).toHaveLength(2);
      expect(results[0].handle).toBe("alice.bsky.social");
    });

    it("returns empty on API error", async () => {
      worker.use(
        http.get("https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead", () => {
          return new HttpResponse(null, { status: 500 });
        }),
      );

      const results = await searchHandleSuggestions("test");
      expect(results).toEqual([]);
    });

    it("supports abort signal", async () => {
      worker.use(
        http.get(
          "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead",
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            return HttpResponse.json({ actors: [] });
          },
        ),
      );

      const controller = new AbortController();
      controller.abort();
      await expect(searchHandleSuggestions("test", controller.signal)).rejects.toThrow();
    });

    it("handles missing actors field in response", async () => {
      worker.use(
        http.get("https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead", () => {
          return HttpResponse.json({});
        }),
      );

      const results = await searchHandleSuggestions("test");
      expect(results).toEqual([]);
    });

    it("encodes special characters in query", async () => {
      let capturedUrl = "";
      worker.use(
        http.get(
          "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead",
          ({ request }) => {
            capturedUrl = request.url;
            return HttpResponse.json({ actors: [] });
          },
        ),
      );

      await searchHandleSuggestions("user@example.com");
      expect(capturedUrl).toContain("q=user%40example.com");
    });

    it("trims whitespace from query", async () => {
      let capturedUrl = "";
      worker.use(
        http.get(
          "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead",
          ({ request }) => {
            capturedUrl = request.url;
            return HttpResponse.json({ actors: [] });
          },
        ),
      );

      await searchHandleSuggestions("  alice  ");
      expect(capturedUrl).toContain("q=alice");
    });

    it("returns actors without optional fields", async () => {
      worker.use(
        http.get("https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead", () => {
          return HttpResponse.json({
            actors: [{ did: "did:plc:xyz", handle: "minimal.bsky.social" }],
          });
        }),
      );

      const results = await searchHandleSuggestions("min");
      expect(results).toHaveLength(1);
      expect(results[0].displayName).toBeUndefined();
      expect(results[0].avatar).toBeUndefined();
    });
  });
});
