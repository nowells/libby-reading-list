import type { Page } from "@playwright/test";
import { TEST_PDS_ORIGIN } from "./catalog";
import type { MockPds } from "./pds";

export interface FakeBlueskyAccount {
  did: string;
  handle: string;
  /** PDS origin override; defaults to TEST_PDS_ORIGIN. */
  pdsUrl?: string;
}

/**
 * Wires `window.__shelfcheckTestOAuth` on every page load. The hook:
 *
 * - Persists the active session across reloads via sessionStorage so
 *   the OAuth `redirect → re-init` round-trip can be simulated by a
 *   simple `window.location.reload()`.
 * - Looks up the requested handle in the catalog the test passed in.
 *   When the handle is unknown the sign-in fails — production code
 *   throws "Failed to sign in with Bluesky" which is what we want to
 *   surface to the user under test.
 *
 * The hook installs against the page's `window`, so each page gets a
 * fresh instance. The PDS state itself lives in the test process via
 * route handlers (see `MockPds`) and persists across reloads.
 */
export async function installOAuthHook(page: Page, accounts: FakeBlueskyAccount[]): Promise<void> {
  await page.addInitScript(
    ({ accounts, defaultPds }) => {
      const STORAGE_KEY = "shelfcheck-test:active-bsky-session";
      const FRESH_KEY = "shelfcheck-test:fresh-flag";

      const known = new Map<string, { did: string; handle: string; pdsUrl: string }>();
      for (const a of accounts) {
        const session = { did: a.did, handle: a.handle, pdsUrl: a.pdsUrl ?? defaultPds };
        known.set(a.handle.toLowerCase(), session);
        known.set(a.did, session);
      }

      function readActive() {
        try {
          const raw = sessionStorage.getItem(STORAGE_KEY);
          if (!raw) return null;
          return JSON.parse(raw) as { did: string; handle: string; pdsUrl: string };
        } catch {
          return null;
        }
      }

      function writeActive(session: { did: string; handle: string; pdsUrl: string } | null) {
        if (session) {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        } else {
          sessionStorage.removeItem(STORAGE_KEY);
        }
      }

      window.__shelfcheckTestOAuth = {
        getActiveSession: () => readActive(),
        consumeFresh() {
          const flag = sessionStorage.getItem(FRESH_KEY) === "1";
          if (flag) sessionStorage.removeItem(FRESH_KEY);
          return flag;
        },
        async signIn(handleOrPds: string) {
          const key = handleOrPds.toLowerCase().replace(/^@/, "");
          const session = known.get(key);
          if (!session) {
            throw new Error(`Unknown test handle: ${handleOrPds}`);
          }
          writeActive(session);
          sessionStorage.setItem(FRESH_KEY, "1");
          return session;
        },
        async signOut() {
          writeActive(null);
          sessionStorage.removeItem(FRESH_KEY);
        },
      };
    },
    { accounts, defaultPds: TEST_PDS_ORIGIN },
  );
}

/**
 * Pre-register a session on the next page load — equivalent to having
 * just completed the OAuth dance. Useful for tests that want to land on
 * a page already authenticated. The `fresh` flag controls whether the
 * subsequent `attachSession` runs in bootstrap mode (push local up).
 */
export async function preauthorizeBlueskySession(
  page: Page,
  account: FakeBlueskyAccount,
  opts: { fresh?: boolean; pds?: MockPds } = {},
): Promise<void> {
  if (opts.pds) opts.pds.upsertProfile(account.did, account.handle);
  await page.addInitScript(
    ({ account, defaultPds, fresh }) => {
      const STORAGE_KEY = "shelfcheck-test:active-bsky-session";
      const FRESH_KEY = "shelfcheck-test:fresh-flag";
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          did: account.did,
          handle: account.handle,
          pdsUrl: account.pdsUrl ?? defaultPds,
        }),
      );
      if (fresh) sessionStorage.setItem(FRESH_KEY, "1");
    },
    { account, defaultPds: TEST_PDS_ORIGIN, fresh: !!opts.fresh },
  );
}
