import { describe, it, expect, vi, beforeEach } from "vitest";
import { isBookhiveSyncStale, searchHandleSuggestions } from "./atproto";
import { setBookhiveLastSync } from "./storage";
import { worker } from "~/test/setup";
import { http, HttpResponse } from "msw";

describe("atproto", () => {
  describe("isBookhiveSyncStale", () => {
    it("returns true when no last sync exists", () => {
      expect(isBookhiveSyncStale()).toBe(true);
    });

    it("returns true when last sync is invalid", () => {
      // Store raw invalid value bypassing the helper to test parsing
      localStorage.setItem("shelfcheck:bookhive-last-sync", JSON.stringify("not-a-date"));
      expect(isBookhiveSyncStale()).toBe(true);
    });

    it("returns true when last sync is older than 24 hours", () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      setBookhiveLastSync(old);
      expect(isBookhiveSyncStale()).toBe(true);
    });

    it("returns false when last sync is recent", () => {
      const recent = new Date(Date.now() - 1000).toISOString();
      setBookhiveLastSync(recent);
      expect(isBookhiveSyncStale()).toBe(false);
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

  describe("isBookhiveSyncStale edge cases", () => {
    it("returns true at exactly 24 hours boundary", () => {
      const exactBoundary = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1).toISOString();
      setBookhiveLastSync(exactBoundary);
      expect(isBookhiveSyncStale()).toBe(true);
    });

    it("returns false just before 24 hours", () => {
      const justBefore = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
      setBookhiveLastSync(justBefore);
      expect(isBookhiveSyncStale()).toBe(false);
    });
  });
});
