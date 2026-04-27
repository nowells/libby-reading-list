import type { OAuthSession } from "@atproto/oauth-client-browser";

/**
 * Shape of the test session that Playwright (or any other test harness)
 * can inject via `window.__shelfcheckTestOAuth`. The PDS URL is a
 * normal HTTPS origin that the test environment is expected to route-mock.
 */
interface TestBlueskySession {
  did: string;
  handle: string;
  pdsUrl: string;
}

/**
 * Hook the app reaches for when running in a test harness. The harness
 * installs an implementation on `window.__shelfcheckTestOAuth` and the
 * app uses it instead of the real `BrowserOAuthClient`. Production
 * builds never expose this hook (the harness alone defines the global).
 */
interface TestOAuthHook {
  /** Currently active session, or null when signed out. */
  getActiveSession(): TestBlueskySession | null;
  /**
   * Mark the session installed by the harness as "fresh" so the app
   * treats the next init as an OAuth callback (triggering bootstrap).
   * Returns true exactly once per fresh sign-in.
   */
  consumeFresh(): boolean;
  /** Begin sign-in for the supplied handle. The harness records the session and the app reloads. */
  signIn(handleOrPds: string): Promise<TestBlueskySession>;
  /** Clear the session for the supplied DID. */
  signOut(did: string): Promise<void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __shelfcheckTestOAuth: TestOAuthHook | undefined;
  interface Window {
    __shelfcheckTestOAuth?: TestOAuthHook;
  }
}

export function getTestOAuthHook(): TestOAuthHook | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__shelfcheckTestOAuth;
}

/**
 * Build a SessionManager-shaped wrapper that the @atproto/api `Agent`
 * accepts. The Agent calls `fetchHandler(url, init)` for every XRPC
 * request; we forward those to the harness-controlled PDS origin so
 * Playwright route handlers can serve them.
 */
export function makeTestOAuthSession(stored: TestBlueskySession): OAuthSession {
  return {
    did: stored.did,
    fetchHandler: (url: string, init?: RequestInit) => {
      const target = stored.pdsUrl.replace(/\/$/, "") + url;
      return fetch(target, init);
    },
  } as unknown as OAuthSession;
}
