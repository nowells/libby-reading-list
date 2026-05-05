import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, Outlet, useMatches, useNavigation } from "react-router";
import { Logo } from "~/components/logo";

interface NavHandle {
  /** Identifier of the active top-level nav item, e.g. "books". */
  navActive?: string;
  /**
   * Page title shown in the shared header. Either a static string or a
   * function that derives it from the route's loader data — useful for
   * detail pages where the title comes from a fetched record.
   */
  pageTitle?: string | ((data: unknown) => string | undefined);
}

const HeaderActionContext = createContext<HTMLDivElement | null>(null);

/**
 * Renders its children into the shared header's per-page action slot.
 * Used by routes that want a contextual button (e.g. "+ Add" on /books)
 * to live inside the sticky header rather than in the page body. We
 * also emit a thin vertical divider after the action so the page-action
 * zone reads as visually separate from the global nav — and pages that
 * don't render a HeaderAction have neither button nor divider.
 */
export function HeaderAction({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderActionContext);
  if (!slot) return null;
  return createPortal(
    <>
      {children}
      <span aria-hidden className="w-px h-5 bg-gray-300 dark:bg-gray-600 flex-shrink-0" />
    </>,
    slot,
  );
}

const NAV_ITEMS: { key: string; to: string; label: string; icon: React.ReactNode }[] = [
  {
    key: "books",
    to: "/books",
    label: "Books",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
        />
      </svg>
    ),
  },
  {
    key: "authors",
    to: "/authors",
    label: "Authors",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
        />
      </svg>
    ),
  },
  {
    key: "shelf",
    to: "/shelf",
    label: "Shelf",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 19.5h16.5M4.5 6.75h15M5.25 4.5v15M18.75 4.5v15M9 4.5v15M15 4.5v15"
        />
      </svg>
    ),
  },
  {
    key: "friends",
    to: "/friends",
    label: "Friends",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
        />
      </svg>
    ),
  },
  {
    key: "stats",
    to: "/stats",
    label: "Stats",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
        />
      </svg>
    ),
  },
  {
    key: "setup",
    to: "/setup",
    label: "Settings",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export default function MainLayout() {
  const matches = useMatches();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);

  // Walk matches deepest-first; first match with a navActive / pageTitle wins.
  let navActive: string | undefined;
  let pageTitle: string | undefined;
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i].handle as NavHandle | undefined;
    if (!navActive && handle?.navActive) navActive = handle.navActive;
    if (!pageTitle && handle?.pageTitle) {
      pageTitle =
        typeof handle.pageTitle === "function"
          ? handle.pageTitle(matches[i].data)
          : handle.pageTitle;
    }
    if (navActive && pageTitle) break;
  }

  return (
    <HeaderActionContext.Provider value={actionSlot}>
      {/* Sticky (rather than fixed) so the header takes its 56px of layout
          space at the top — child <main className="min-h-screen"> blocks
          flow naturally underneath without needing a magic padding spacer. */}
      <header className="sticky top-0 z-30 bg-white/85 dark:bg-gray-900/85 backdrop-blur-md border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto h-14 px-4 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 flex-shrink-0" aria-label="ShelfCheck">
            <Logo className="w-8 h-8" />
          </Link>
          {pageTitle && (
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white truncate min-w-0">
              {pageTitle}
            </h1>
          )}
          <div ref={setActionSlot} className="ml-auto flex items-center gap-3" />
          <nav className="flex items-center gap-3 sm:gap-4">
            {NAV_ITEMS.map((item) => {
              const active = navActive === item.key;
              return (
                <Link
                  key={item.key}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  // Active vs inactive is just text weight + color
                  // contrast — no padded pill background, since amber
                  // owns the "action" affordance and the header has
                  // limited horizontal room (page title would otherwise
                  // get truncated on mobile).
                  className={
                    active
                      ? "inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white"
                      : "inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  }
                >
                  {item.icon}
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        {/* Subtle indeterminate progress that shimmers across while the data
            router is fetching loaders for the next page. */}
        <div
          aria-hidden={!isLoading}
          className={`absolute left-0 right-0 -bottom-px h-0.5 overflow-hidden pointer-events-none ${
            isLoading ? "" : "invisible"
          }`}
        >
          <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-purple-500 to-transparent animate-nav-loading" />
        </div>
      </header>
      <Outlet />
    </HeaderActionContext.Provider>
  );
}
