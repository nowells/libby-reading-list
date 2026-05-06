import { createContext, useContext, useMemo } from "react";
import { useLocation } from "react-router";

/**
 * A single entry in the navigation history that detail pages render as
 * a "Back to ..." affordance. We keep this minimal — just the URL to
 * navigate back to (used for fallback / rendering the link target) and
 * the human-readable label that goes after "Back to".
 */
export interface Crumb {
  path: string;
  label: string;
}

/**
 * Shape carried in `react-router` `useLocation().state` for any
 * navigation that we want to chain into a back-trail.
 */
interface CrumbLocationState {
  crumbStack?: Crumb[];
}

/**
 * Cap so a long detail-to-detail chain (book → author → another book →
 * another author → ...) can't grow without bound. Older entries are
 * dropped from the front when the limit is hit.
 */
const CRUMB_STACK_MAX = 10;

/**
 * Read the crumb stack carried by the current location's router state.
 * Tent-pole pages (/books, /authors, /friends/:handle, ...) reset this
 * to `[self]`; detail pages (/book/:workId, /author/:authorKey) chain
 * onto it. The last element is what the current page's "Back to ..."
 * link should target.
 */
export function useCrumbStack(): Crumb[] {
  const location = useLocation();
  const state = location.state as CrumbLocationState | null | undefined;
  return state?.crumbStack ?? [];
}

/**
 * Build the state object to pass to `<Link state={...} />` when
 * navigating from this page to a detail page. Tent-pole sources reset
 * the stack to `[self]`; detail-page sources push their own crumb
 * onto the stack they themselves received.
 */
function buildOutgoingCrumbState(
  currentStack: Crumb[],
  self: Crumb,
  options: { resetStack?: boolean } = {},
): CrumbLocationState {
  if (options.resetStack) {
    return { crumbStack: [self] };
  }
  const next = [...currentStack, self];
  if (next.length > CRUMB_STACK_MAX) {
    next.splice(0, next.length - CRUMB_STACK_MAX);
  }
  return { crumbStack: next };
}

/**
 * Convenience: combine `useCrumbStack` + `buildOutgoingCrumbState`.
 * Memoized so passing the result as `<Link state>` doesn't churn every
 * render. Pass `resetStack: true` when the calling route is a tent-pole
 * (its own page is the start of the trail and any prior history is
 * intentionally discarded — this is the contract the user asked for).
 */
export function useOutgoingCrumbState(
  self: Crumb,
  options: { resetStack?: boolean } = {},
): CrumbLocationState {
  const currentStack = useCrumbStack();
  return useMemo(
    () => buildOutgoingCrumbState(currentStack, self, options),
    // currentStack is a fresh array on every render, but the *content*
    // only changes when a real navigation happens — comparing by JSON
    // is cheap (≤10 small entries) and avoids spurious re-memoizations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(currentStack), self.path, self.label, options.resetStack],
  );
}

/**
 * Context that exposes the *outgoing* crumb state to descendant
 * components so a shared card / link can pass `state={...}` to
 * `<Link>` without each page having to thread the value down by hand.
 */
const OutgoingCrumbStateContext = createContext<CrumbLocationState | undefined>(undefined);

export const CrumbStateProvider = OutgoingCrumbStateContext.Provider;

/**
 * Read the outgoing crumb state set by the nearest enclosing route.
 * Returns `undefined` when no provider wraps the component, so
 * `<Link state={useOutgoingCrumb()}>` is a no-op outside the
 * tent-pole / detail-page chain.
 */
export function useOutgoingCrumb(): CrumbLocationState | undefined {
  return useContext(OutgoingCrumbStateContext);
}
