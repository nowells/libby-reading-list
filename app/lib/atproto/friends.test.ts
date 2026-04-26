import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverFriends, type FriendProfile } from "./friends";
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
    mockGetFollows.mockResolvedValue(makeFollowsResponse([]));
  });

  describe("discoverFriends", () => {
    it("returns empty array when user has no follows", async () => {
      const result = await discoverFriends(fakeSession);
      expect(result).toEqual([]);
    });

    it("finds friends who have shelfcheck records", async () => {
      const shelfEntry = makeShelfEntry();
      const authorFollow = makeAuthorFollow();

      mockGetFollows.mockResolvedValue(makeFollowsResponse([fakeFollow]));

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
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
      mockGetFollows.mockResolvedValue(
        makeFollowsResponse([{ did: "did:plc:nobooks", handle: "nobooks.bsky.social" }]),
      );

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
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
      mockGetFollows.mockResolvedValue(
        makeFollowsResponse([
          { did: "did:plc:a", handle: "a.bsky.social" },
          { did: "did:plc:b", handle: "b.bsky.social" },
        ]),
      );

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
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

    it("handles fetch errors gracefully for individual follows", async () => {
      mockGetFollows.mockResolvedValue(
        makeFollowsResponse([{ did: "did:plc:error", handle: "error.bsky.social" }]),
      );

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
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
});
