import { Link, redirect, useNavigate, useSearchParams } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { CrumbStateProvider, useCrumbStack, useOutgoingCrumbState } from "~/lib/crumb";
import { DetailBackLink } from "~/components/detail-back-link";
import { addBook, getBooks, getLibraries } from "~/lib/storage";
import { resolveWorkIdByTitleAuthor } from "~/lib/openlibrary";

export const handle = {
  navActive: "books",
  pageTitle: "Book details",
};

export function meta() {
  return [{ title: "Book | ShelfCheck" }];
}

export function clientLoader() {
  const libraries = getLibraries();
  if (libraries.length === 0) {
    throw redirect("/setup");
  }
  return null;
}

/**
 * Fallback landing page reached from a series card when the OL workId
 * isn't yet resolved (or doesn't exist). Resolves on mount and replaces
 * the URL with the real /book/<workId> when found, otherwise shows a
 * graceful "we don't have a detail page for this one" fallback that
 * still lets the user shelve the book.
 */
export default function BookFind() {
  const [params] = useSearchParams();
  const title = (params.get("title") ?? "").trim();
  const author = (params.get("author") ?? "").trim();
  const cover = params.get("cover") ?? undefined;
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"resolving" | "not-found">("resolving");

  // Mirror the /book/<workId> crumb plumbing so the back link points
  // sensibly (to wherever the user came from) even on the fallback page.
  const incomingCrumbStack = useCrumbStack();
  const outgoingCrumbState = useOutgoingCrumbState({
    path: `/book/find?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`,
    label: title || "this book",
  });

  useEffect(() => {
    if (!title || !author) {
      navigate("/books", { replace: true });
      return;
    }
    let cancelled = false;
    void resolveWorkIdByTitleAuthor(title, author).then((workId) => {
      if (cancelled) return;
      if (workId) {
        navigate(`/book/${workId}`, { replace: true });
      } else {
        setPhase("not-found");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [title, author, navigate]);

  const alreadyOnShelf = useMemo(() => {
    if (!title || !author) return false;
    const lowerTitle = title.toLowerCase();
    const lowerAuthor = author.toLowerCase();
    return getBooks().some(
      (b) => b.title.toLowerCase() === lowerTitle && b.author.toLowerCase() === lowerAuthor,
    );
  }, [title, author]);

  const [added, setAdded] = useState(false);

  const handleAdd = () => {
    addBook({
      title,
      author,
      source: "unknown",
      imageUrl: cover,
      status: "wantToRead",
    });
    setAdded(true);
  };

  return (
    <CrumbStateProvider value={outgoingCrumbState}>
      <main className="min-h-screen py-8 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="mb-3">
            <DetailBackLink
              stack={incomingCrumbStack}
              fallback={{ path: "/books", label: "your books" }}
            />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row gap-5">
              <div className="flex-shrink-0 mx-auto sm:mx-0">
                {cover ? (
                  <img
                    src={cover}
                    alt=""
                    className="w-32 sm:w-40 aspect-[2/3] object-cover rounded-lg shadow"
                  />
                ) : (
                  <div className="w-32 sm:w-40 aspect-[2/3] rounded-lg bg-gray-100 dark:bg-gray-700" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                  {title || "Loading…"}
                </h1>
                {author && (
                  <p className="text-base text-gray-600 dark:text-gray-400 mt-1">by {author}</p>
                )}
                {phase === "resolving" ? (
                  <div className="mt-4 inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <span className="inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    Looking this book up…
                  </div>
                ) : (
                  <>
                    <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                      We couldn’t find a detailed Open Library record for this book, so the rich
                      details page isn’t available yet. You can still shelve it and check Libby
                      directly.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {alreadyOnShelf || added ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                          <svg
                            className="w-4 h-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M4.5 12.75l6 6 9-13.5"
                            />
                          </svg>
                          On your want-to-read list
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={handleAdd}
                          className="px-3 py-1.5 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                        >
                          Want to read
                        </button>
                      )}
                      <Link
                        to="/books"
                        className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        Back to your books
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </CrumbStateProvider>
  );
}
