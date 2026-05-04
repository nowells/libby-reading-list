import { describe, it, expect } from "vitest";
import {
  getLastPdsSync,
  searchHandleSuggestions,
  getLastSignedInAccount,
  clearLastSignedInAccount,
} from "./atproto";
import { worker } from "~/test/setup";
import { http, HttpResponse } from "msw";

const TEST_DID = "did:plc:testuser";

describe("atproto", () => {
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

  describe("getLastSignedInAccount", () => {
    it("returns null when no account is remembered", () => {
      expect(getLastSignedInAccount()).toBeNull();
    });

    it("round-trips a stored account with handle", () => {
      localStorage.setItem(
        "shelfcheck:bsky-last-account",
        JSON.stringify({ did: TEST_DID, handle: "alice.bsky.social" }),
      );
      expect(getLastSignedInAccount()).toEqual({
        did: TEST_DID,
        handle: "alice.bsky.social",
      });
    });

    it("normalizes a stored account without a handle", () => {
      localStorage.setItem("shelfcheck:bsky-last-account", JSON.stringify({ did: TEST_DID }));
      expect(getLastSignedInAccount()).toEqual({ did: TEST_DID, handle: undefined });
    });

    it("returns null for malformed JSON", () => {
      localStorage.setItem("shelfcheck:bsky-last-account", "{not json");
      expect(getLastSignedInAccount()).toBeNull();
    });

    it("returns null when stored payload has no did", () => {
      localStorage.setItem(
        "shelfcheck:bsky-last-account",
        JSON.stringify({ handle: "alice.bsky.social" }),
      );
      expect(getLastSignedInAccount()).toBeNull();
    });
  });

  describe("clearLastSignedInAccount", () => {
    it("removes the remembered account", () => {
      localStorage.setItem(
        "shelfcheck:bsky-last-account",
        JSON.stringify({ did: TEST_DID, handle: "alice.bsky.social" }),
      );
      clearLastSignedInAccount();
      expect(getLastSignedInAccount()).toBeNull();
    });

    it("is a no-op when nothing is stored", () => {
      expect(() => clearLastSignedInAccount()).not.toThrow();
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
