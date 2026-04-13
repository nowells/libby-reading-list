import { Link, redirect } from "react-router";
import { getBooks, getLibraries } from "~/lib/storage";
import { Logo } from "~/components/logo";

export function meta() {
  return [
    { title: "ShelfCheck" },
    {
      name: "description",
      content: "Find your want-to-read books available at your local library via Libby.",
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
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-950 dark:to-gray-900">
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
              Upload a CSV export from{" "}
              <a
                href="https://www.goodreads.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-amber-700 dark:text-amber-400 underline hover:text-amber-800 dark:hover:text-amber-300"
              >
                Goodreads
              </a>{" "}
              or{" "}
              <a
                href="https://hardcover.app"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-amber-700 dark:text-amber-400 underline hover:text-amber-800 dark:hover:text-amber-300"
              >
                Hardcover
              </a>
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
