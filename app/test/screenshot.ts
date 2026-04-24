import { page } from "vitest/browser";
import type { RenderResult } from "vitest-browser-react";

/**
 * Returns a locator for the first rendered child element,
 * useful for tightly scoping VRT screenshots to the component under test.
 */
export function componentLocator(screen: RenderResult) {
  const el = screen.container.firstElementChild;
  if (!el) throw new Error("No rendered element found");
  return page.elementLocator(el);
}
