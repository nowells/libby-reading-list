import { redirect, Link } from "react-router";
import type { Route } from "./+types/home";
import { getSession } from "~/lib/session.server";

export function meta() {
  return [
    { title: "HardcoverLibby" },
    {
      name: "description",
      content:
        "Find your Hardcover wishlist books available at your local library via Libby.",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  const hardcoverKey = session.get("hardcoverApiKey");
  const libraryKey = session.get("libraryKey");

  if (hardcoverKey && libraryKey) {
    throw redirect("/books");
  }

  return { hasHardcoverKey: !!hardcoverKey, hasLibraryKey: !!libraryKey };
}

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-950 dark:to-gray-900">
      <div className="max-w-xl w-full mx-4 text-center">
        <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-4">
          HardcoverLibby
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
          Find your Hardcover "Want to Read" books that are available at your
          local library through Libby.
        </p>

        <div className="space-y-4 text-left bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            How it works
          </h2>
          <ol className="list-decimal list-inside space-y-3 text-gray-700 dark:text-gray-300">
            <li>
              Connect your{" "}
              <span className="font-medium text-amber-700 dark:text-amber-400">
                Hardcover
              </span>{" "}
              account with an API key
            </li>
            <li>
              Select your{" "}
              <span className="font-medium text-blue-700 dark:text-blue-400">
                Libby
              </span>{" "}
              library
            </li>
            <li>
              See which books on your wishlist are available to borrow right now
            </li>
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
