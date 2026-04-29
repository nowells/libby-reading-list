import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  discoverFriends,
  PDS_CACHE_KEY,
  PDS_CACHE_VERSION,
  RELAY_HOST,
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

const RELAY_LIST_PATH = "com.atproto.sync.listReposByCollection";

/** Body for a relay listReposByCollection response. */
function relayResponse(dids: string[]): Response {
  return new Response(JSON.stringify({ repos: dids.map((did) => ({ did })) }));
}

// Use a function constructor for the mock so `new Agent(...)` works
const mockGetFollows = vi.fn();

vi.mock("@atproto/api", () => ({
  Agent: function Agent() {
    return {
      app: {
        bsky: {
          graph: {
            getFollows: mockGetFollows,
          },
        },
      },
    };
  },
}));

function countPlcCalls(spy: ReturnType<typeof vi.spyOn>): number {
  return spy.mock.calls.filter((args: unknown[]) => {
    const input = args[0] as RequestInfo | URL;
    const url = typeof input === "string" ? input : ((input as Request).url ?? String(input));
    return url.includes("plc.directory");
  }).length;
}

function makeFollowsResponse(follows: FriendProfile[]) {
  return {
    data: {
      subject: {},
      follows: follows.map((f) => ({
        did: f.did,
        handle: f.handle,
        displayName: f.displayName,
        avatar: f.avatar,
        indexedAt: "",
        labels: [],
        createdAt: "",
      })),
      cursor: undefined,
    },
    headers: {},
    success: true,
  };
}

describe("friends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPdsRunCacheForTests();
    mockGetFollows.mockResolvedValue(makeFollowsResponse([]));
  });

  describe("discoverFriends", () => {
    it("returns empty array when user has no follows", async () => {
      // Even with zero follows we still issue the relay call in parallel; mock
      // it so the test stays hermetic.
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => relayResponse([]));

      const result = await discoverFriends(fakeSession);
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });

    it("finds friends who have shelfcheck records", async () => {
      const shelfEntry = makeShelfEntry();
      const authorFollow = makeAuthorFollow();

      mockGetFollows.mockResolvedValue(makeFollowsResponse([fakeFollow]));

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          return relayResponse([fakeFollow.did]);
        }
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

    it("skips follows whose PDS shelf is empty even when the relay reports them", async () => {
      // Relay says the DID has shelfcheck records (e.g. they did once) but the
      // PDS now returns nothing — they've deleted everything. Drop them.
      mockGetFollows.mockResolvedValue(
        makeFollowsResponse([{ did: "did:plc:nobooks", handle: "nobooks.bsky.social" }]),
      );

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          return relayResponse(["did:plc:nobooks"]);
        }
        if (url.includes("plc.directory")) {
          return new Response(JSON.stringify(didDoc("did:plc:nobooks")));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await discoverFriends(fakeSession);
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });

    it("filters out follows the relay does not list, without per-PDS lookups", async () => {
      // The relay's listReposByCollection narrows candidates *before* any PDS
      // call. Confirm DIDs the relay omits never trigger a plc.directory or
      // listRecords request.
      const friend: FriendProfile = { did: "did:plc:user-yes", handle: "yes.bsky.social" };
      const stranger: FriendProfile = { did: "did:plc:user-no", handle: "no.bsky.social" };
      mockGetFollows.mockResolvedValue(makeFollowsResponse([friend, stranger]));

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          return relayResponse([friend.did]);
        }
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        if (url.includes(NSID.shelfEntry)) {
          return new Response(
            JSON.stringify({
              records: [{ uri: "at://x/1", value: makeShelfEntry({ title: "Found" }) }],
            }),
          );
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await discoverFriends(fakeSession);

      expect(result).toHaveLength(1);
      expect(result[0].profile.did).toBe(friend.did);

      // No PDS resolution or listRecords call should have happened for the
      // stranger — that's the whole point of the relay narrowing.
      const strangerCalls = fetchSpy.mock.calls.filter((args) => {
        const input = args[0] as RequestInfo | URL;
        const url = typeof input === "string" ? input : ((input as Request).url ?? String(input));
        return url.includes(stranger.did);
      });
      expect(strangerCalls).toHaveLength(0);

      fetchSpy.mockRestore();
    });

    it("falls back to scanning every follow when the relay endpoint fails", async () => {
      // If the relay returns an error (or doesn't implement the endpoint),
      // we must not silently exclude everyone — fall back to per-follow scans.
      const friend: FriendProfile = { did: "did:plc:fallback", handle: "fb.bsky.social" };
      mockGetFollows.mockResolvedValue(makeFollowsResponse([friend]));

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          return new Response("Not Implemented", { status: 501 });
        }
        if (url.includes("plc.directory")) {
          return new Response(JSON.stringify(didDoc(friend.did)));
        }
        if (url.includes(NSID.shelfEntry)) {
          return new Response(
            JSON.stringify({
              records: [{ uri: "at://x/1", value: makeShelfEntry({ title: "Fallback" }) }],
            }),
          );
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await discoverFriends(fakeSession);

      expect(result).toHaveLength(1);
      expect(result[0].profile.did).toBe(friend.did);

      fetchSpy.mockRestore();
    });

    it("uses the configured relay host", async () => {
      mockGetFollows.mockResolvedValue(makeFollowsResponse([fakeFollow]));

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) return relayResponse([]);
        if (url.includes("plc.directory")) {
          return new Response(JSON.stringify(didDoc(fakeFollow.did)));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      await discoverFriends(fakeSession);

      const relayCalls = fetchSpy.mock.calls.filter((args) => {
        const input = args[0] as RequestInfo | URL;
        const url = typeof input === "string" ? input : ((input as Request).url ?? String(input));
        return url.includes(RELAY_LIST_PATH);
      });
      expect(relayCalls.length).toBeGreaterThan(0);
      const firstUrl = relayCalls[0][0] as string;
      expect(firstUrl.startsWith(RELAY_HOST)).toBe(true);
      expect(firstUrl).toContain(`collection=${encodeURIComponent(NSID.shelfEntry)}`);

      fetchSpy.mockRestore();
    });

    it("reports progress via callback", async () => {
      mockGetFollows.mockResolvedValue(
        makeFollowsResponse([
          { did: "did:plc:a", handle: "a.bsky.social" },
          { did: "did:plc:b", handle: "b.bsky.social" },
        ]),
      );

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          return relayResponse(["did:plc:a", "did:plc:b"]);
        }
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
      mockGetFollows.mockResolvedValue(
        makeFollowsResponse(
          Array.from({ length: 20 }, (_, i) => ({
            did: `did:plc:user${i}`,
            handle: `user${i}.bsky.social`,
          })),
        ),
      );

      const controller = new AbortController();
      controller.abort();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          // Relay reports every DID so we can be sure the abort check is what
          // empties the result, not the relay narrowing filter.
          return relayResponse(Array.from({ length: 20 }, (_, i) => `did:plc:user${i}`));
        }
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
      mockGetFollows.mockResolvedValue(makeFollowsResponse([fakeFollow]));

      const totalBooks = 250;
      const pageSize = 100;

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          return relayResponse([fakeFollow.did]);
        }
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
      mockGetFollows.mockResolvedValue(
        makeFollowsResponse([{ did: "did:plc:error", handle: "error.bsky.social" }]),
      );

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          return relayResponse(["did:plc:error"]);
        }
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
      mockGetFollows.mockResolvedValue(makeFollowsResponse([friend]));

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          return relayResponse([friend.did]);
        }
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

      mockGetFollows.mockResolvedValue(makeFollowsResponse([friend]));
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          return relayResponse([friend.did]);
        }
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

      mockGetFollows.mockResolvedValue(makeFollowsResponse([friend]));
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          return relayResponse([friend.did]);
        }
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

      mockGetFollows.mockResolvedValue(makeFollowsResponse([friend]));
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          return relayResponse([friend.did]);
        }
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
      mockGetFollows.mockResolvedValue(makeFollowsResponse([friend]));
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes(RELAY_LIST_PATH)) {
          return relayResponse([friend.did]);
        }
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
