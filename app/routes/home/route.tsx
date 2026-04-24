import { Link, redirect } from "react-router";
import { getBooks, getLibraries } from "~/lib/storage";
import { Logo } from "~/components/logo";

export function meta() {
  return [
    { title: "ShelfCheck — Your Reading List, Your Library, Available Now" },
    {
      name: "description",
      content:
        "Upload your Goodreads, Hardcover, StoryGraph, or Lyndi CSV reading list — or sign in with Bluesky to live-sync your Bookhive library — and instantly see which books are available to borrow for free at your local library through Libby.",
    },
  ];
}

export function clientLoader() {
  const books = getBooks();
  const libraries = getLibraries();
  if (books.length > 0 && libraries.length > 0) {
    throw redirect("/books");
  }
  return null;
}

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="max-w-xl w-full mx-4 text-center">
        <div className="flex items-center justify-center gap-3 mb-4">
          <Logo className="w-14 h-14" />
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white">ShelfCheck</h1>
        </div>
        <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
          Find your "Want to Read" books that are available at your local library through Libby.
        </p>

        <div className="space-y-4 text-left bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">How it works</h2>
          <ol className="list-decimal list-inside space-y-3 text-gray-700 dark:text-gray-300">
            <li>
              Import your reading list:
              <ol className="list-[lower-alpha] list-inside ml-6 mt-2 space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li>
                  Sign in with{" "}
                  <a
                    href="https://bsky.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-sky-700 dark:text-sky-400 underline hover:text-sky-800 dark:hover:text-sky-300"
                  >
                    Bluesky
                  </a>{" "}
                  to live-sync your{" "}
                  <a
                    href="https://bookhive.buzz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-sky-700 dark:text-sky-400 underline hover:text-sky-800 dark:hover:text-sky-300"
                  >
                    Bookhive
                  </a>{" "}
                  library — updates automatically when your shelf changes
                </li>
                <li>
                  Or upload a CSV from{" "}
                  <a
                    href="https://www.goodreads.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-amber-700 dark:text-amber-400 underline hover:text-amber-800 dark:hover:text-amber-300"
                  >
                    Goodreads
                  </a>
                  ,{" "}
                  <a
                    href="https://hardcover.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-amber-700 dark:text-amber-400 underline hover:text-amber-800 dark:hover:text-amber-300"
                  >
                    Hardcover
                  </a>
                  , or{" "}
                  <a
                    href="https://thestorygraph.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-amber-700 dark:text-amber-400 underline hover:text-amber-800 dark:hover:text-amber-300"
                  >
                    The StoryGraph
                  </a>
                </li>
                <li>
                  Or create a simple{" "}
                  <span className="font-medium text-amber-700 dark:text-amber-400">Lyndi CSV</span>{" "}
                  with Title and Author columns — great for custom lists
                </li>
              </ol>
            </li>
            <li>
              Select your{" "}
              <a
                href="https://libbyapp.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-blue-700 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300"
              >
                Libby
              </a>{" "}
              library
            </li>
            <li>See which books on your wishlist are available to borrow right now</li>
          </ol>
        </div>

        <Link
          to="/setup"
          className="inline-flex items-center px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors"
        >
          Get Started
        </Link>
      </div>
    </main>
  );
}
