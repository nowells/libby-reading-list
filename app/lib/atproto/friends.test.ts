import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  discoverFriends,
  PDS_CACHE_KEY,
  PDS_CACHE_VERSION,
  _resetPdsRunCacheForTests,
  type FriendProfile,
} from "./friends";
import { NSID, STATUS, type ShelfEntryRecord, type AuthorFollowRecord } from "./lexicon";

function makeShelfEntry(overrides: Partial<ShelfEntryRecord> = {}): ShelfEntryRecord {
  return {
    status: STATUS.wantToRead,
    title: "Test Book",
    authors: [{ name: "Test Author" }],
    ids: { olWorkId: "OL123W" },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAuthorFollow(overrides: Partial<AuthorFollowRecord> = {}): AuthorFollowRecord {
  return {
    name: "Followed Author",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const fakeFollow: FriendProfile = {
  did: "did:plc:friend1",
  handle: "friend1.bsky.social",
  displayName: "Friend One",
};

const fakeSession = { did: "did:plc:testuser" } as never;

/** Returns a DID doc pointing at a fake PDS */
function didDoc(did: string) {
  return {
    id: did,
    service: [
      {
        id: "#atproto_pds",
        type: "AtprotoPersonalDataServer",
        serviceEndpoint: "https://pds.example.com",
      },
    ],
  };
}

/**
 * Module-scope state for the AppView getFollows mock. Each test sets this
 * before installing a fetch spy; the spy serves the matching AppView URL
 * with these follows.
 */
let currentFollows: FriendProfile[] = [];

function isGetFollowsUrl(url: string): boolean {
  return url.includes("public.api.bsky.app") && url.includes("app.bsky.graph.getFollows");
}

function followsResponse(): Response {
  return new Response(
    JSON.stringify({
      follows: currentFollows.map((f) => ({
        did: f.did,
        handle: f.handle,
        displayName: f.displayName,
        avatar: f.avatar,
      })),
      cursor: undefined,
    }),
  );
}

function countPlcCalls(spy: ReturnType<typeof vi.spyOn>): number {
  return spy.mock.calls.filter((args: unknown[]) => {
    const input = args[0] as RequestInfo | URL;
    const url = typeof input === "string" ? input : ((input as Request).url ?? String(input));
    return url.includes("plc.directory");
  }).length;
}

describe("friends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPdsRunCacheForTests();
    currentFollows = [];
  });

  describe("discoverFriends", () => {
    it("returns empty array when user has no follows", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isGetFollowsUrl(url)) return followsResponse();
        return new Response(JSON.stringify({ records: [] }));
      });
      const result = await discoverFriends(fakeSession);
      expect(result).toEqual([]);
      fetchSpy.mockRestore();
    });

    it("finds friends who have shelfcheck records", async () => {
      const shelfEntry = makeShelfEntry();
      const authorFollow = makeAuthorFollow();

      currentFollows = [fakeFollow];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isGetFollowsUrl(url)) return followsResponse();
        if (url.includes("plc.directory")) {
          return new Response(JSON.stringify(didDoc(fakeFollow.did)));
        }
        if (url.includes(NSID.shelfEntry)) {
          return new Response(
            JSON.stringify({ records: [{ uri: "at://test/entry/1", value: shelfEntry }] }),
          );
        }
        if (url.includes(NSID.authorFollow)) {
          return new Response(
            JSON.stringify({ records: [{ uri: "at://test/author/1", value: authorFollow }] }),
          );
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await discoverFriends(fakeSession);

      expect(result).toHaveLength(1);
      expect(result[0].profile.did).toBe(fakeFollow.did);
      expect(result[0].profile.handle).toBe(fakeFollow.handle);
      expect(result[0].entries).toHaveLength(1);
      expect(result[0].entries[0].title).toBe("Test Book");
      expect(result[0].authors).toHaveLength(1);
      expect(result[0].authors[0].name).toBe("Followed Author");

      fetchSpy.mockRestore();
    });

    it("skips follows who have no shelfcheck records", async () => {
      currentFollows = [{ did: "did:plc:nobooks", handle: "nobooks.bsky.social" }];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isGetFollowsUrl(url)) return followsResponse();
        if (url.includes("plc.directory")) {
          return new Response(JSON.stringify(didDoc("did:plc:nobooks")));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await discoverFriends(fakeSession);
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });

    it("reports progress via callback", async () => {
      currentFollows = [
        { did: "did:plc:a", handle: "a.bsky.social" },
        { did: "did:plc:b", handle: "b.bsky.social" },
      ];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isGetFollowsUrl(url)) return followsResponse();
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const progressCalls: [number, number][] = [];
      await discoverFriends(fakeSession, {
        onProgress: (checked, total) => progressCalls.push([checked, total]),
      });

      expect(progressCalls.length).toBeGreaterThan(0);
      const lastCall = progressCalls[progressCalls.length - 1];
      expect(lastCall[0]).toBe(lastCall[1]);

      fetchSpy.mockRestore();
    });

    it("respects abort signal", async () => {
      currentFollows = Array.from({ length: 20 }, (_, i) => ({
        did: `did:plc:user${i}`,
        handle: `user${i}.bsky.social`,
      }));

      const controller = new AbortController();
      controller.abort();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isGetFollowsUrl(url)) return followsResponse();
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await discoverFriends(fakeSession, { signal: controller.signal });
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });

    it("pages through all shelf entries past the 100-record limit", async () => {
      // A returning user with 250 books used to be capped at 100 because
      // listPdsRecords defaulted limit=100 and exited the cursor loop.
      // Verify every record now comes back.
      currentFollows = [fakeFollow];

      const totalBooks = 250;
      const pageSize = 100;

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isGetFollowsUrl(url)) return followsResponse();
        if (url.includes("plc.directory")) {
          return new Response(JSON.stringify(didDoc(fakeFollow.did)));
        }
        if (url.includes(NSID.shelfEntry)) {
          const u = new URL(url);
          const cursor = u.searchParams.get("cursor");
          const offset = cursor ? parseInt(cursor, 10) : 0;
          const remaining = totalBooks - offset;
          if (remaining <= 0) {
            return new Response(JSON.stringify({ records: [] }));
          }
          const take = Math.min(pageSize, remaining);
          const records = Array.from({ length: take }, (_, i) => ({
            uri: `at://test/entry/${offset + i}`,
            value: makeShelfEntry({ title: `Book ${offset + i}` }),
          }));
          const nextOffset = offset + take;
          const body: { records: typeof records; cursor?: string } = { records };
          if (nextOffset < totalBooks) body.cursor = String(nextOffset);
          return new Response(JSON.stringify(body));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await discoverFriends(fakeSession);

      expect(result).toHaveLength(1);
      expect(result[0].entries).toHaveLength(totalBooks);
      expect(result[0].entries[0].title).toBe("Book 0");
      expect(result[0].entries[totalBooks - 1].title).toBe(`Book ${totalBooks - 1}`);

      fetchSpy.mockRestore();
    });

    it("handles fetch errors gracefully for individual follows", async () => {
      currentFollows = [{ did: "did:plc:error", handle: "error.bsky.social" }];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isGetFollowsUrl(url)) return followsResponse();
        if (url.includes("plc.directory")) {
          return new Response(JSON.stringify(didDoc("did:plc:error")));
        }
        return new Response("Server Error", { status: 500 });
      });

      const result = await discoverFriends(fakeSession);
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });
  });

  describe("PDS metadata cache", () => {
    it("persists resolved PDS endpoints to localStorage", async () => {
      const friend: FriendProfile = {
        did: "did:plc:cachetest1",
        handle: "cachetest1.bsky.social",
      };
      currentFollows = [friend];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isGetFollowsUrl(url)) return followsResponse();
        if (url.includes("plc.directory")) {
          return new Response(JSON.stringify(didDoc(friend.did)));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      await discoverFriends(fakeSession);

      const raw = localStorage.getItem(PDS_CACHE_KEY);
      expect(raw).not.toBeNull();
      const stored = JSON.parse(raw!);
      expect(stored.version).toBe(PDS_CACHE_VERSION);
      expect(stored.entries[friend.did].pds).toBe("https://pds.example.com");
      expect(typeof stored.entries[friend.did].fetchedAt).toBe("number");

      fetchSpy.mockRestore();
    });

    it("skips plc.directory when a fresh cache entry exists", async () => {
      const friend: FriendProfile = {
        did: "did:plc:cachetest2",
        handle: "cachetest2.bsky.social",
      };
      localStorage.setItem(
        PDS_CACHE_KEY,
        JSON.stringify({
          version: PDS_CACHE_VERSION,
          entries: {
            [friend.did]: { pds: "https://pds.example.com", fetchedAt: Date.now() },
          },
        }),
      );

      currentFollows = [friend];
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isGetFollowsUrl(url)) return followsResponse();
        if (url.includes("plc.directory")) {
          return new Response(JSON.stringify(didDoc(friend.did)));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      await discoverFriends(fakeSession);

      expect(countPlcCalls(fetchSpy)).toBe(0);

      fetchSpy.mockRestore();
    });

    it("re-resolves when the cached entry has aged past the TTL", async () => {
      const friend: FriendProfile = {
        did: "did:plc:cachetest3",
        handle: "cachetest3.bsky.social",
      };
      const thirtyOneDaysMs = 1000 * 60 * 60 * 24 * 31;
      localStorage.setItem(
        PDS_CACHE_KEY,
        JSON.stringify({
          version: PDS_CACHE_VERSION,
          entries: {
            [friend.did]: {
              pds: "https://stale.example.com",
              fetchedAt: Date.now() - thirtyOneDaysMs,
            },
          },
        }),
      );

      currentFollows = [friend];
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isGetFollowsUrl(url)) return followsResponse();
        if (url.includes("plc.directory")) {
          return new Response(JSON.stringify(didDoc(friend.did)));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      await discoverFriends(fakeSession);

      expect(countPlcCalls(fetchSpy)).toBe(1);
      const stored = JSON.parse(localStorage.getItem(PDS_CACHE_KEY)!);
      expect(stored.entries[friend.did].pds).toBe("https://pds.example.com");

      fetchSpy.mockRestore();
    });

    it("ignores cache entries with a mismatched version", async () => {
      const friend: FriendProfile = {
        did: "did:plc:cachetest4",
        handle: "cachetest4.bsky.social",
      };
      localStorage.setItem(
        PDS_CACHE_KEY,
        JSON.stringify({
          version: PDS_CACHE_VERSION + 99,
          entries: {
            [friend.did]: { pds: "https://stale.example.com", fetchedAt: Date.now() },
          },
        }),
      );

      currentFollows = [friend];
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isGetFollowsUrl(url)) return followsResponse();
        if (url.includes("plc.directory")) {
          return new Response(JSON.stringify(didDoc(friend.did)));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      await discoverFriends(fakeSession);

      expect(countPlcCalls(fetchSpy)).toBe(1);

      fetchSpy.mockRestore();
    });

    it("does not persist failed resolutions", async () => {
      const friend: FriendProfile = {
        did: "did:plc:cachetest5",
        handle: "cachetest5.bsky.social",
      };
      currentFollows = [friend];
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isGetFollowsUrl(url)) return followsResponse();
        if (url.includes("plc.directory")) {
          return new Response("Not Found", { status: 404 });
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      await discoverFriends(fakeSession);

      const raw = localStorage.getItem(PDS_CACHE_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      expect(stored?.entries?.[friend.did]).toBeUndefined();

      fetchSpy.mockRestore();
    });
  });
});
