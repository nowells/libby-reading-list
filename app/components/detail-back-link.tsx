import { Link, useNavigate } from "react-router";
import type { Crumb } from "~/lib/crumb";

interface Props {
  /** Crumb stack carried by the current page's location state. */
  stack: Crumb[];
  /**
   * Used when the stack is empty — i.e. the user arrived via a direct
   * URL (refresh, shared link, bookmark) rather than in-app navigation.
   * For book details that's typically `/books`; for author details,
   * `/authors`.
   */
  fallback: Crumb;
  className?: string;
}

/**
 * Back-affordance for detail pages. When the user arrived via an
 * in-app link the stack tells us the immediate previous page — render
 * its label and use browser-back so the previous page's own crumb
 * stack is restored intact (so a → b → c → c "Back to b" → b still
 * shows "Back to a"). Falls back to a forward navigation to the
 * canonical tent-pole page when arriving cold.
 */
export function DetailBackLink({ stack, fallback, className }: Props) {
  const navigate = useNavigate();
  const last = stack.length > 0 ? stack[stack.length - 1] : null;
  const target = last ?? fallback;

  function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!last) return;
    // Honour modifier-clicks / middle-click for "open in new tab" semantics.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(-1);
  }

  return (
    <Link
      to={target.path}
      onClick={onClick}
      className={
        // Match the amber accent used by /books, /authors, and the
        // existing "Back to your books / authors" links on the
        // detail-page error states. Defaulting to gray made the
        // affordance feel disabled next to the rest of the chrome.
        className ??
        "inline-flex items-center text-sm text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
      }
    >
      ← Back to {target.label}
    </Link>
  );
}
