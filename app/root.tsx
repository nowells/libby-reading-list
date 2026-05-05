import { usePostHog } from "@posthog/react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { SwUpdateNotification } from "~/components/sw-update-notification";
import { ThemeSelector } from "~/components/theme-selector";
import { Logo } from "~/components/logo";
import type { Route } from "./+types/root";
import "./app.css";

const themeInitScript = `(function(){try{var t=localStorage.getItem("shelfcheck:theme");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme:dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})();`;

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>ShelfCheck — Your Reading List, Your Library, Available Now</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#d97706" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://www.shelfcheck.org" />
        <meta
          property="og:title"
          content="ShelfCheck — Your Reading List, Your Library, Available Now"
        />
        <meta
          property="og:description"
          content="Upload your Goodreads or Hardcover reading list and instantly see which books are available to borrow for free at your local library through Libby."
        />
        <meta property="og:image" content="https://www.shelfcheck.org/og-image.png" />
        <meta property="og:site_name" content="ShelfCheck" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content="ShelfCheck — Your Reading List, Your Library, Available Now"
        />
        <meta
          name="twitter:description"
          content="Upload your Goodreads or Hardcover reading list and instantly see which books are available to borrow for free at your local library through Libby."
        />
        <meta name="twitter:image" content="https://www.shelfcheck.org/og-image.png" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen flex flex-col">
        <SwUpdateNotification />
        <div className="flex-1">{children}</div>
        <footer className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <span>Made by Nowell for Carmen with ❤️</span>
            <span>·</span>
            <a
              href="https://github.com/nowells/libby-reading-list"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              GitHub
            </a>
            <span>·</span>
            <ThemeSelector />
          </div>
        </footer>
        <ScrollRestoration />
        <Scripts />
        <script
          dangerouslySetInnerHTML={{
            __html: `if("serviceWorker"in navigator){window.addEventListener("load",()=>{navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).then(function(r){r.update();setInterval(function(){r.update()},60*60*1000);document.addEventListener("visibilitychange",function(){document.visibilityState==="visible"&&r.update()})})})}`,
          }}
        />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function HydrateFallback() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <Logo className="w-16 h-16 mx-auto mb-4 animate-pulse" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">ShelfCheck</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let details = "An unexpected error occurred. Please try refreshing the page.";
  let stack: string | undefined;
  let statusCode: number | undefined;

  const posthog = usePostHog();
  posthog?.captureException(error);

  if (isRouteErrorResponse(error)) {
    statusCode = error.status;
    if (error.status === 404) {
      title = "Page not found";
      details = "The page you're looking for doesn't exist or has been moved.";
    } else {
      title = `Error ${error.status}`;
      details = error.statusText || details;
    }
  } else if (error instanceof Error) {
    if (import.meta.env.DEV) {
      details = error.message;
      stack = error.stack;
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg
              className="w-7 h-7 text-red-500 dark:text-red-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          </div>

          {statusCode && (
            <p className="text-sm font-medium text-gray-400 dark:text-gray-500 mb-1">
              {statusCode}
            </p>
          )}
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{title}</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{details}</p>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors text-sm"
            >
              Refresh page
            </button>
            {statusCode === 404 && (
              <a
                href="/"
                className="w-full inline-block px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium rounded-lg transition-colors text-sm"
              >
                Go to homepage
              </a>
            )}
          </div>
        </div>

        {stack && (
          <details className="mt-4 text-left">
            <summary className="text-xs text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400">
              Technical details
            </summary>
            <pre className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs text-gray-600 dark:text-gray-400 overflow-x-auto max-h-48">
              <code>{stack}</code>
            </pre>
          </details>
        )}
      </div>
    </main>
  );
}
