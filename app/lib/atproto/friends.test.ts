import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  discoverFriends,
  fetchFriendShelf,
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
};

const fakeSession = { did: "did:plc:testuser" } as never;

const FAKE_PDS = "https://pds.example.com";

/**
 * Default handle for a DID — keyed off the last path segment so each fake
 * DID gets a stable, distinct handle resolved from its DID doc.
 */
function handleFor(did: string): string {
  return `${did.replace(/^did:plc:/, "")}.bsky.social`;
}

/** Returns a DID doc pointing at a fake PDS, with alsoKnownAs handle URI. */
function didDoc(did: string, handle: string = handleFor(did)) {
  return {
    id: did,
    alsoKnownAs: [`at://${handle}`],
    service: [
      {
        id: "#atproto_pds",
        type: "AtprotoPersonalDataServer",
        serviceEndpoint: FAKE_PDS,
      },
    ],
  };
}

/**
 * Module-scope list of follow subject DIDs. Each test sets this before
 * installing a fetch spy; the spy serves them as `app.bsky.graph.follow`
 * records on the user's own PDS.
 */
let currentFollowDids: string[] = [];

/** Matches the listRecords call against the *user's own* PDS for follow records. */
function isOwnFollowsListUrl(url: string): boolean {
  return (
    url.startsWith(FAKE_PDS) &&
    url.includes("/xrpc/com.atproto.repo.listRecords") &&
    url.includes("collection=app.bsky.graph.follow")
  );
}

function ownFollowsResponse(): Response {
  return new Response(
    JSON.stringify({
      records: currentFollowDids.map((did, i) => ({
        uri: `at://did:plc:testuser/app.bsky.graph.follow/${i}`,
        value: { subject: did, createdAt: new Date().toISOString() },
      })),
      cursor: undefined,
    }),
  );
}

/**
 * Count plc.directory calls for a specific DID. We filter per-DID because
 * `getFollows` now resolves the user's own DID (to find their PDS) in
 * addition to each follow, so a global plc-call count would conflate the
 * two.
 */
function countPlcCallsFor(spy: ReturnType<typeof vi.spyOn>, did: string): number {
  return spy.mock.calls.filter((args: unknown[]) => {
    const input = args[0] as RequestInfo | URL;
    const url = typeof input === "string" ? input : ((input as Request).url ?? String(input));
    return url.includes("plc.directory") && url.includes(did);
  }).length;
}

describe("friends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPdsRunCacheForTests();
    currentFollowDids = [];
    localStorage.clear();
  });

  describe("discoverFriends", () => {
    it("returns empty array when user has no follows", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
        return new Response(JSON.stringify({ records: [] }));
      });
      const result = await discoverFriends(fakeSession);
      expect(result).toEqual([]);
      fetchSpy.mockRestore();
    });

    it("finds friends who have shelfcheck records", async () => {
      const shelfEntry = makeShelfEntry();
      const authorFollow = makeAuthorFollow();

      currentFollowDids = [fakeFollow.did];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
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
      currentFollowDids = ["did:plc:nobooks"];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await discoverFriends(fakeSession);
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });

    it("reports progress via callback", async () => {
      currentFollowDids = ["did:plc:a", "did:plc:b"];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
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
      currentFollowDids = Array.from({ length: 20 }, (_, i) => `did:plc:user${i}`);

      const controller = new AbortController();
      controller.abort();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
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
      currentFollowDids = [fakeFollow.did];

      const totalBooks = 250;
      const pageSize = 100;

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
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
            // Unique workId per book — otherwise the read-side dedupe
            // (sibling helper of the PDS-side one) collapses them all
            // into one record because makeShelfEntry's defaults share an
            // olWorkId.
            value: makeShelfEntry({
              title: `Book ${offset + i}`,
              ids: { olWorkId: `OL${offset + i}W` },
            }),
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
      currentFollowDids = ["did:plc:error"];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        return new Response("Server Error", { status: 500 });
      });

      const result = await discoverFriends(fakeSession);
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });

    it("enriches friend profile with displayName and avatar from PDS profile record", async () => {
      currentFollowDids = [fakeFollow.did];
      const avatarCid = "bafyfakeavataracidstring";

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        if (url.includes(NSID.shelfEntry)) {
          return new Response(
            JSON.stringify({ records: [{ uri: "at://test/entry/1", value: makeShelfEntry() }] }),
          );
        }
        if (url.includes("getRecord") && url.includes("app.bsky.actor.profile")) {
          return new Response(
            JSON.stringify({
              uri: `at://${fakeFollow.did}/app.bsky.actor.profile/self`,
              cid: "fakeprofilecid",
              value: {
                displayName: "Friend One",
                avatar: { ref: { $link: avatarCid }, mimeType: "image/jpeg" },
              },
            }),
          );
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await discoverFriends(fakeSession);
      expect(result).toHaveLength(1);
      expect(result[0].profile.displayName).toBe("Friend One");
      expect(result[0].profile.avatar).toContain("com.atproto.sync.getBlob");
      expect(result[0].profile.avatar).toContain(avatarCid);
      expect(result[0].profile.avatar).toContain(encodeURIComponent(fakeFollow.did));

      fetchSpy.mockRestore();
    });

    it("treats RecordNotFound on profile lookup as no-profile, not failure", async () => {
      currentFollowDids = [fakeFollow.did];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        if (url.includes(NSID.shelfEntry)) {
          return new Response(
            JSON.stringify({ records: [{ uri: "at://test/entry/1", value: makeShelfEntry() }] }),
          );
        }
        if (url.includes("getRecord") && url.includes("app.bsky.actor.profile")) {
          return new Response(JSON.stringify({ error: "RecordNotFound" }), { status: 400 });
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await discoverFriends(fakeSession);
      expect(result).toHaveLength(1);
      expect(result[0].profile.handle).toBe(fakeFollow.handle);
      expect(result[0].profile.displayName).toBeUndefined();
      expect(result[0].profile.avatar).toBeUndefined();

      fetchSpy.mockRestore();
    });

    it("preserves caller-supplied profile fields when profile fetch errors transiently", async () => {
      // Caller (use-friends.ts on refresh) passes a cached FriendProfile
      // with displayName + avatar. If the friend's PDS is having issues
      // we should not clobber those cached values.
      const cachedProfile: FriendProfile = {
        did: "did:plc:cachedfriend",
        handle: "cachedfriend.bsky.social",
        displayName: "Cached Display",
        avatar: "https://cached.example.com/avatar.jpg",
      };
      currentFollowDids = [];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        if (url.includes(NSID.shelfEntry)) {
          return new Response(
            JSON.stringify({ records: [{ uri: "at://test/entry/1", value: makeShelfEntry() }] }),
          );
        }
        if (url.includes("getRecord") && url.includes("app.bsky.actor.profile")) {
          return new Response("Bad Gateway", { status: 502 });
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await fetchFriendShelf(cachedProfile);
      expect(result).not.toBeNull();
      expect(result!.profile.displayName).toBe("Cached Display");
      expect(result!.profile.avatar).toBe("https://cached.example.com/avatar.jpg");

      fetchSpy.mockRestore();
    });

    it("throws when the friend's PDS returns a non-OK status", async () => {
      // Self-hosted PDS down. listPdsRecords now throws so callers can
      // tell this apart from a successful empty response and preserve
      // any cached data they already had for this friend.
      const friend: FriendProfile = {
        did: "did:plc:offline",
        handle: "offline.example.com",
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        if (url.includes(NSID.shelfEntry)) {
          return new Response("Bad Gateway", { status: 502 });
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      await expect(fetchFriendShelf(friend)).rejects.toThrow();

      fetchSpy.mockRestore();
    });

    it("dedupes the friend's PDS records so a stale upstream doesn't inflate the shelf", async () => {
      // The friend may not have run our updated PDS-side dedupe yet, so
      // their repo can still hold parallel records for the same book —
      // mixed workId/fuzzy or divergent olWorkIds across multi-source
      // imports. Surfacing those as separate rows would inflate the
      // friend's book counts and pollute their shelf in our UI; the
      // read-side dedupe should collapse them down to one entry per work.
      const friend: FriendProfile = {
        did: "did:plc:dupes",
        handle: "dupes.example.com",
      };

      const dup = (overrides: Partial<ShelfEntryRecord>) =>
        makeShelfEntry({
          title: "The Wife Between Us",
          authors: [{ name: "Greer Hendricks" }],
          ...overrides,
        });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        if (url.includes(NSID.shelfEntry)) {
          return new Response(
            JSON.stringify({
              records: [
                // Two divergent olWorkIds for the same book.
                { uri: "at://test/entry/1", value: dup({ ids: { olWorkId: "OL19735648W" } }) },
                { uri: "at://test/entry/2", value: dup({ ids: { olWorkId: "OL20189911W" } }) },
                // A fuzzy-only sibling — same title+author, no workId.
                { uri: "at://test/entry/3", value: dup({ ids: {} }) },
                // An unrelated book that should survive untouched.
                {
                  uri: "at://test/entry/4",
                  value: makeShelfEntry({
                    title: "Different Book",
                    authors: [{ name: "Other Author" }],
                    ids: { olWorkId: "OL999W" },
                  }),
                },
              ],
            }),
          );
        }
        if (url.includes(NSID.authorFollow)) {
          // Same author landed twice — once name-only, once with olKey.
          return new Response(
            JSON.stringify({
              records: [
                {
                  uri: "at://test/author/a1",
                  value: makeAuthorFollow({ name: "Greer Hendricks" }),
                },
                {
                  uri: "at://test/author/a2",
                  value: makeAuthorFollow({
                    name: "Greer Hendricks",
                    olAuthorKey: "OL12345A",
                  }),
                },
              ],
            }),
          );
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await fetchFriendShelf(friend);
      expect(result).not.toBeNull();
      // Three duplicate "The Wife Between Us" records collapse to one;
      // "Different Book" stays.
      expect(result!.entries).toHaveLength(2);
      const titles = result!.entries.map((e) => e.title).sort();
      expect(titles).toEqual(["Different Book", "The Wife Between Us"]);
      // The author follow with the olAuthorKey wins.
      expect(result!.authors).toHaveLength(1);
      expect(result!.authors[0].olAuthorKey).toBe("OL12345A");

      fetchSpy.mockRestore();
    });

    it("attaches refreshedAt to the returned shelf so the UI can show staleness", async () => {
      const friend: FriendProfile = {
        did: "did:plc:fresh",
        handle: "fresh.example.com",
      };
      const before = Date.now();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        if (url.includes(NSID.shelfEntry)) {
          return new Response(
            JSON.stringify({ records: [{ uri: "at://test/entry/1", value: makeShelfEntry() }] }),
          );
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      const result = await fetchFriendShelf(friend);
      expect(result).not.toBeNull();
      expect(result!.refreshedAt).toBeGreaterThanOrEqual(before);

      fetchSpy.mockRestore();
    });
  });

  describe("PDS metadata cache", () => {
    it("persists resolved PDS endpoints to localStorage", async () => {
      const friend: FriendProfile = {
        did: "did:plc:cachetest1",
        handle: "cachetest1.bsky.social",
      };
      currentFollowDids = [friend.did];

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      await discoverFriends(fakeSession);

      const raw = localStorage.getItem(PDS_CACHE_KEY);
      expect(raw).not.toBeNull();
      const stored = JSON.parse(raw!);
      expect(stored.version).toBe(PDS_CACHE_VERSION);
      expect(stored.entries[friend.did].pds).toBe(FAKE_PDS);
      expect(stored.entries[friend.did].handle).toBe(friend.handle);
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
            [friend.did]: { pds: FAKE_PDS, handle: friend.handle, fetchedAt: Date.now() },
          },
        }),
      );

      currentFollowDids = [friend.did];
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      await discoverFriends(fakeSession);

      expect(countPlcCallsFor(fetchSpy, friend.did)).toBe(0);

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
              handle: "stale.bsky.social",
              fetchedAt: Date.now() - thirtyOneDaysMs,
            },
          },
        }),
      );

      currentFollowDids = [friend.did];
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      await discoverFriends(fakeSession);

      expect(countPlcCallsFor(fetchSpy, friend.did)).toBe(1);
      const stored = JSON.parse(localStorage.getItem(PDS_CACHE_KEY)!);
      expect(stored.entries[friend.did].pds).toBe(FAKE_PDS);
      expect(stored.entries[friend.did].handle).toBe(friend.handle);

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
            [friend.did]: {
              pds: "https://stale.example.com",
              handle: "stale.bsky.social",
              fetchedAt: Date.now(),
            },
          },
        }),
      );

      currentFollowDids = [friend.did];
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
        if (url.includes("plc.directory")) {
          const did = url.split("/").pop()!;
          return new Response(JSON.stringify(didDoc(did)));
        }
        return new Response(JSON.stringify({ records: [] }));
      });

      await discoverFriends(fakeSession);

      expect(countPlcCallsFor(fetchSpy, friend.did)).toBe(1);

      fetchSpy.mockRestore();
    });

    it("does not persist failed resolutions", async () => {
      const friend: FriendProfile = {
        did: "did:plc:cachetest5",
        handle: "cachetest5.bsky.social",
      };
      currentFollowDids = [friend.did];
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (isOwnFollowsListUrl(url)) return ownFollowsResponse();
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
