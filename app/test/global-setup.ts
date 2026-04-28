// Vitest 4.1's Logger constructor registers a process-level
// `unhandledRejection` handler that prints the error and immediately
// calls `process.exit()`, before any test config or `onUnhandledError`
// hook can intervene. In browser mode, several upstream pieces produce
// unhandled rejections during normal page teardown that are not
// actionable but still kill the whole run:
//
//   - `[birpc] rpc is closed` — vitest-monocart-coverage attaches a CDP
//     Debugger.scriptParsed listener and intentionally never unbinds it
//     (its stopCoverage is a no-op so V8 coverage state survives across
//     files); the next event after a page closes rejects.
//   - `Failed to load url …` — Vite's loadAndTransform racing with the
//     test page navigating away.
//   - `Failed to fetch` (AbortError) — a component's useEffect fetch
//     racing with unmount; the AbortController rejects after the test
//     has already finished asserting.
//
// Real test failures still surface as assertion errors / timeouts, and
// real app bugs reachable during a test still show up that way. So
// trimming this teardown noise is safe and unblocks CI without masking
// regressions.
//
// This globalSetup runs after Vitest's Logger is constructed, so we can
// wrap each existing `unhandledRejection` listener with a filter that
// swallows the known teardown patterns and forwards everything else to
// the original handler unchanged.
const TEARDOWN_NOISE = ["rpc is closed", "Failed to load url", "Failed to fetch"];

export default function setup() {
  type RejectionHandler = (err: unknown) => void;
  const listeners = process.listeners("unhandledRejection") as RejectionHandler[];

  for (const listener of listeners) {
    const wrapped: RejectionHandler = (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (TEARDOWN_NOISE.some((pat) => msg.includes(pat))) return;
      listener(err);
    };
    process.off("unhandledRejection", listener);
    process.on("unhandledRejection", wrapped);
  }
}
