import { describe, it, expect, beforeEach } from "vitest";
import { IdbCache } from "./idb-cache";

interface TestEntry {
  fetchedAt: number;
  payload: string;
}

async function makeCache(opts: {
  dbName: string;
  legacy?: string;
  maxEntries?: number;
}): Promise<IdbCache<TestEntry>> {
  const cache = new IdbCache<TestEntry>({
    dbName: opts.dbName,
    storeName: "entries",
    legacyLocalStorageKey: opts.legacy,
    maxEntries: opts.maxEntries,
  });
  await cache.whenHydrated();
  return cache;
}

async function flushPending(): Promise<void> {
  // Two microtask drains: one to run the queued flush, another to let the
  // resulting IDB transaction's onsuccess settle before the next read.
  await Promise.resolve();
  await Promise.resolve();
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

const TEST_DB_NAMES = [
  "test-db-basic",
  "test-db-persist",
  "test-db-migrate",
  "test-db-evict",
  "test-db-delete",
  "test-db-corrupt",
];

describe("IdbCache", () => {
  beforeEach(async () => {
    localStorage.clear();
    // Drop any leftover databases from a previous test run so each case
    // starts from a clean slate (otherwise version-1 opens would skip the
    // upgrade path and find an empty / incomplete schema).
    await Promise.all(TEST_DB_NAMES.map(deleteDb));
  });

  it("stores and retrieves entries through the in-memory mirror", async () => {
    const cache = await makeCache({ dbName: "test-db-basic" });
    cache.set("k1", { fetchedAt: 100, payload: "hello" });
    expect(cache.get("k1")?.payload).toBe("hello");
    await cache.__resetForTest();
  });

  it("persists entries across cache instances via IDB", async () => {
    const a = await makeCache({ dbName: "test-db-persist" });
    a.set("persisted", { fetchedAt: 1, payload: "across" });
    await flushPending();

    // New instance pointing at the same store should hydrate the entry.
    const b = await makeCache({ dbName: "test-db-persist" });
    expect(b.get("persisted")?.payload).toBe("across");

    await a.__resetForTest();
    await b.__resetForTest();
  });

  it("migrates legacy localStorage data into IDB and removes the legacy key", async () => {
    const legacyKey = "shelfcheck:test-legacy";
    const legacyData = {
      "legacy-1": { fetchedAt: 1, payload: "from-localstorage" },
    };
    localStorage.setItem(legacyKey, JSON.stringify(legacyData));

    const cache = await makeCache({ dbName: "test-db-migrate", legacy: legacyKey });
    expect(cache.get("legacy-1")?.payload).toBe("from-localstorage");
    expect(localStorage.getItem(legacyKey)).toBeNull();

    await cache.__resetForTest();
  });

  it("evicts oldest entries when maxEntries is exceeded", async () => {
    const cache = await makeCache({ dbName: "test-db-evict", maxEntries: 2 });
    cache.set("a", { fetchedAt: 1, payload: "a" });
    cache.set("b", { fetchedAt: 2, payload: "b" });
    cache.set("c", { fetchedAt: 3, payload: "c" });
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")?.payload).toBe("b");
    expect(cache.get("c")?.payload).toBe("c");
    await cache.__resetForTest();
  });

  it("delete removes from both mirror and IDB", async () => {
    const cache = await makeCache({ dbName: "test-db-delete" });
    cache.set("gone", { fetchedAt: 1, payload: "x" });
    await flushPending();
    cache.delete("gone");
    await flushPending();

    const fresh = await makeCache({ dbName: "test-db-delete" });
    expect(fresh.get("gone")).toBeUndefined();

    await cache.__resetForTest();
    await fresh.__resetForTest();
  });

  it("ignores corrupt legacy JSON without crashing", async () => {
    const legacyKey = "shelfcheck:test-corrupt";
    localStorage.setItem(legacyKey, "{not valid json");

    const cache = await makeCache({ dbName: "test-db-corrupt", legacy: legacyKey });
    expect(cache.size()).toBe(0);
    expect(localStorage.getItem(legacyKey)).toBeNull();

    await cache.__resetForTest();
  });
});
