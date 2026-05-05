import { describe, it, expect, vi } from "vitest";
import { listRecords } from "./records";
import { NSID, STATUS, type ShelfEntryRecord } from "./lexicon";
import type { OAuthSession } from "@atproto/oauth-client-browser";

/**
 * The Agent constructor in @atproto/api treats any object with a
 * `fetchHandler` method as a SessionManager and routes XRPC traffic through
 * it — so we can drop in a stub here and intercept every listRecords call
 * without standing up the real OAuth session machinery.
 */
function makeFakeSession(
  did: string,
  fetchHandler: (url: string, init: RequestInit) => Promise<Response>,
): OAuthSession {
  return {
    did,
    fetchHandler: vi.fn(fetchHandler),
  } as unknown as OAuthSession;
}

function makeShelfRecordValue(title: string): ShelfEntryRecord {
  return {
    status: STATUS.wantToRead,
    title,
    authors: [{ name: "Test Author" }],
    ids: { olWorkId: `OL${title.replace(/\s+/g, "")}W` },
    createdAt: new Date().toISOString(),
  };
}

describe("listRecords", () => {
  it("paginates past the 100-record page size", async () => {
    // Reproduces the suspected cause of "exactly 100 books on signin".
    // listRecords must walk every page until the PDS stops returning a
    // cursor, not stop after the first 100-record response.
    const totalRecords = 250;
    const pageSize = 100;
    let pageCalls = 0;

    const session = makeFakeSession("did:plc:test", async (url) => {
      const u = new URL(url);
      const cursor = u.searchParams.get("cursor");
      const offset = cursor ? parseInt(cursor, 10) : 0;
      pageCalls++;

      const remaining = totalRecords - offset;
      const take = Math.max(0, Math.min(pageSize, remaining));
      const records = Array.from({ length: take }, (_, i) => ({
        uri: `at://did:plc:test/${NSID.shelfEntry}/r${offset + i}`,
        cid: "bafyfake",
        value: makeShelfRecordValue(`Book ${offset + i}`),
      }));

      const body: { records: typeof records; cursor?: string } = { records };
      const nextOffset = offset + take;
      if (nextOffset < totalRecords) body.cursor = String(nextOffset);
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    });

    const result = await listRecords<ShelfEntryRecord>(session, NSID.shelfEntry);

    expect(result).toHaveLength(totalRecords);
    expect(pageCalls).toBe(3); // 100 + 100 + 50
    expect(result[0].value.title).toBe("Book 0");
    expect(result[totalRecords - 1].value.title).toBe(`Book ${totalRecords - 1}`);
  });

  it("returns an empty array when the collection is empty", async () => {
    const session = makeFakeSession(
      "did:plc:test",
      async () =>
        new Response(JSON.stringify({ records: [] }), {
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await listRecords<ShelfEntryRecord>(session, NSID.shelfEntry);

    expect(result).toEqual([]);
  });

  it("stops paging when the response omits a cursor even with a full page", async () => {
    // PDS contract: a missing cursor on the response means "no more pages"
    // even if this page filled to the limit. Walk should terminate.
    let calls = 0;
    const session = makeFakeSession("did:plc:test", async () => {
      calls++;
      const records = Array.from({ length: 100 }, (_, i) => ({
        uri: `at://did:plc:test/${NSID.shelfEntry}/r${i}`,
        cid: "bafyfake",
        value: makeShelfRecordValue(`Book ${i}`),
      }));
      return new Response(JSON.stringify({ records }), {
        headers: { "content-type": "application/json" },
      });
    });

    const result = await listRecords<ShelfEntryRecord>(session, NSID.shelfEntry);

    expect(result).toHaveLength(100);
    expect(calls).toBe(1);
  });
});
