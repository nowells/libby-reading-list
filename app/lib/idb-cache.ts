/**
 * IndexedDB-backed key/value cache with a synchronous in-memory mirror.
 *
 * The availability caches used to live in localStorage, where the ~5 MB
 * quota is shared with shelf data. On PWAs that quota was getting eaten by
 * the per-book Libby payloads, causing PDS-pull writes to silently fail and
 * leaving local book counts behind the server count. IDB gives us hundreds
 * of MB and is segregated from the durable shelf data, so the two no longer
 * compete for the same budget.
 *
 * We keep the consumer-facing API synchronous (the existing `getCached` /
 * `readCache` callers all expect that) by mirroring the store into an
 * in-memory Map at module load. Reads always come from the mirror; writes
 * go to the mirror immediately and are flushed to IDB on a microtask so
 * UI work isn't blocked on disk. Pre-hydration reads return undefined —
 * callers that need to wait can `await whenHydrated()` first.
 */

interface Entry<T> {
  value: T;
}

interface IdbCacheOptions {
  dbName: string;
  storeName: string;
  /**
   * If set, on first hydrate we read this key from localStorage, import
   * everything into the IDB store, then delete the localStorage key. This
   * is what reclaims the quota that was being eaten by the legacy cache.
   */
  legacyLocalStorageKey?: string;
  /**
   * Soft cap on entries. When exceeded after a write, we evict the oldest
   * entries by `fetchedAt` until we're back under. A safety backstop —
   * IDB itself has plenty of room, but we don't want a bug somewhere that
   * adds entries forever to grow unbounded.
   */
  maxEntries?: number;
}

export class IdbCache<T extends { fetchedAt: number }> {
  private mem = new Map<string, T>();
  private hydrated = false;
  private hydrationPromise: Promise<void>;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  // Track keys with pending IDB writes/deletes. We coalesce many synchronous
  // sets into a single transaction on the next microtask so importing 100
  // books doesn't fire 100 separate IDB transactions.
  private dirty = new Set<string>();
  private tombstones = new Set<string>();
  private flushPromise: Promise<void> | null = null;
  private flushScheduled = false;

  constructor(private opts: IdbCacheOptions) {
    this.hydrationPromise = this.hydrate();
  }

  whenHydrated(): Promise<void> {
    return this.hydrationPromise;
  }

  isHydrated(): boolean {
    return this.hydrated;
  }

  get(key: string): T | undefined {
    return this.mem.get(key);
  }

  set(key: string, value: T): void {
    this.mem.set(key, value);
    this.tombstones.delete(key);
    this.dirty.add(key);
    this.evictIfOverflow();
    this.scheduleFlush();
  }

  delete(key: string): void {
    this.mem.delete(key);
    this.dirty.delete(key);
    this.tombstones.add(key);
    this.scheduleFlush();
  }

  entries(): [string, T][] {
    return [...this.mem.entries()];
  }

  size(): number {
    return this.mem.size;
  }

  /** Clear the in-memory mirror and the IDB store. */
  async clear(): Promise<void> {
    this.mem.clear();
    this.dirty.clear();
    this.tombstones.clear();
    const db = await this.openDb();
    if (!db) return;
    await runRequest(
      db.transaction(this.opts.storeName, "readwrite").objectStore(this.opts.storeName).clear(),
    );
  }

  /**
   * Test-only: wipe both the in-memory mirror AND the IDB store, then mark
   * the cache as hydrated again so subsequent reads see an empty cache.
   */
  async __resetForTest(): Promise<void> {
    await this.hydrationPromise;
    await this.clear();
    // Drain any pending flushes that might have been queued mid-clear.
    if (this.flushPromise) await this.flushPromise;
  }

  /**
   * Test-only: backdate an entry's fetchedAt so TTL-expiration tests don't
   * have to round-trip through IDB. Mirrors the legacy "poke localStorage
   * directly" trick.
   */
  __backdateForTest(key: string, fetchedAt: number): void {
    const entry = this.mem.get(key);
    if (!entry) return;
    this.mem.set(key, { ...entry, fetchedAt });
  }

  private async hydrate(): Promise<void> {
    try {
      await this.runHydration();
    } catch (err) {
      console.error(
        `[idb-cache] hydration failed for ${this.opts.dbName}/${this.opts.storeName}; continuing with in-memory only`,
        err,
      );
    } finally {
      this.hydrated = true;
    }
  }

  private async runHydration(): Promise<void> {
    if (typeof indexedDB === "undefined") return;

    // Migrate legacy localStorage cache first so we can free that quota
    // even on this very first hydrate — without waiting for the next write.
    const legacy = this.readLegacy();

    const db = await this.openDb();
    if (!db) {
      // IDB is unavailable (e.g. private mode in some Safari versions).
      // Honor the legacy data in memory so we don't lose it; we just won't
      // persist new entries until IDB comes back.
      if (legacy) {
        for (const [key, value] of legacy) this.mem.set(key, value);
      }
      return;
    }

    // Load existing IDB entries into the mirror.
    const tx = db.transaction(this.opts.storeName, "readonly");
    const store = tx.objectStore(this.opts.storeName);
    const records = await runRequest<Array<Entry<T> & { key: string }>>(store.getAll());
    for (const record of records) {
      this.mem.set(record.key, record.value);
    }

    // Apply legacy migration on top — new IDB writes win over stale
    // localStorage data, but if IDB had nothing for a key we adopt the
    // legacy value.
    if (legacy) {
      const writes: Array<[string, Entry<T> & { key: string }]> = [];
      for (const [key, value] of legacy) {
        if (!this.mem.has(key)) {
          this.mem.set(key, value);
          writes.push([key, { key, value }]);
        }
      }
      if (writes.length > 0) {
        const wtx = db.transaction(this.opts.storeName, "readwrite");
        const wstore = wtx.objectStore(this.opts.storeName);
        for (const [, record] of writes) wstore.put(record);
        await txDone(wtx);
      }
      // Free the localStorage budget regardless of whether we adopted
      // anything — the legacy key is no longer the source of truth.
      try {
        localStorage.removeItem(this.opts.legacyLocalStorageKey!);
      } catch {
        // ignore
      }
    }
  }

  private readLegacy(): Array<[string, T]> | null {
    const key = this.opts.legacyLocalStorageKey;
    if (!key) return null;
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, T>;
      const out: Array<[string, T]> = [];
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v.fetchedAt === "number") out.push([k, v]);
      }
      return out;
    } catch {
      // Corrupt JSON — drop it so we don't keep retrying.
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
      return null;
    }
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open(this.opts.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.opts.storeName)) {
            db.createObjectStore(this.opts.storeName, { keyPath: "key" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          console.error(`[idb-cache] failed to open ${this.opts.dbName}`, req.error);
          resolve(null);
        };
        req.onblocked = () => {
          console.warn(`[idb-cache] open blocked for ${this.opts.dbName}`);
        };
      });
    }
    return this.dbPromise;
  }

  private evictIfOverflow(): void {
    const max = this.opts.maxEntries;
    if (!max || this.mem.size <= max) return;
    // Evict oldest by fetchedAt. We expect overflows to be small (one or
    // two entries past the cap), so a full scan is fine.
    const sorted = [...this.mem.entries()].sort(([, a], [, b]) => a.fetchedAt - b.fetchedAt);
    const overflow = this.mem.size - max;
    for (let i = 0; i < overflow; i++) {
      const [key] = sorted[i];
      this.mem.delete(key);
      this.dirty.delete(key);
      this.tombstones.add(key);
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    // Microtask so a burst of synchronous sets (e.g. importing 100 books)
    // flushes in a single transaction.
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flushPromise = this.flush().catch((err) => {
        console.error(`[idb-cache] flush failed for ${this.opts.storeName}`, err);
      });
    });
  }

  private async flush(): Promise<void> {
    // Wait for hydration so we don't race the initial load.
    await this.hydrationPromise;
    if (this.dirty.size === 0 && this.tombstones.size === 0) return;
    const db = await this.openDb();
    if (!db) {
      // No IDB — drop the queues; we already updated the mirror.
      this.dirty.clear();
      this.tombstones.clear();
      return;
    }
    const dirty = [...this.dirty];
    const tombstones = [...this.tombstones];
    this.dirty.clear();
    this.tombstones.clear();

    const tx = db.transaction(this.opts.storeName, "readwrite");
    const store = tx.objectStore(this.opts.storeName);
    for (const key of dirty) {
      const value = this.mem.get(key);
      if (value !== undefined) store.put({ key, value });
    }
    for (const key of tombstones) {
      store.delete(key);
    }
    await txDone(tx);
  }
}

function runRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
