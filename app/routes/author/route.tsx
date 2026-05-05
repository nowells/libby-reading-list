import { Link, redirect, useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import {
  getAuthors,
  getLibraries,
  addAuthor,
  removeAuthor,
  type AuthorEntry,
  type LibraryConfig,
} from "~/lib/storage";
import { getAuthorDetails, getAuthorWorks, type AuthorDetails } from "~/lib/openlibrary-author";
import { Logo } from "~/components/logo";
import { Markdown, truncateMarkdown } from "~/components/markdown";

type LoaderData = {
  libraries: LibraryConfig[];
  authorKey: string;
  validKey: boolean;
  details: AuthorDetails | null;
};

export const handle = {
  navActive: "authors",
  pageTitle: (data: unknown) => (data as LoaderData | undefined)?.details?.name,
};

export function meta({ data }: { data?: LoaderData }) {
  const name = data?.details?.name;
  return [{ title: name ? `${name} | ShelfCheck` : "Author | ShelfCheck" }];
}

export async function clientLoader({
  params,
}: {
  params: { authorKey?: string };
}): Promise<LoaderData> {
  const libraries = getLibraries();
  if (libraries.length === 0) {
    throw redirect("/setup");
  }

  const authorKey = params.authorKey ?? "";
  const validKey = /^OL[A-Z0-9]+A$/.test(authorKey);
  // Pre-fetch author details so meta() can show the real name in the tab.
  // Errors fall back to a null record; the component-level effect will retry.
  const details = validKey ? await getAuthorDetails(authorKey).catch(() => null) : null;

  return { libraries, authorKey, validKey, details };
}

interface DisplayWork {
  title: string;
  workId: string;
  firstPublishYear?: number;
  coverId?: number;
}

export default function AuthorDetailsPage() {
  const { authorKey, validKey, details: initialDetails } = useLoaderData() as LoaderData;

  const [details, setDetails] = useState<AuthorDetails | null>(initialDetails);
  const [detailsLoading, setDetailsLoading] = useState(initialDetails === null && validKey);
  const [works, setWorks] = useState<DisplayWork[]>([]);
  const [worksLoading, setWorksLoading] = useState(true);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [followed, setFollowed] = useState<AuthorEntry | undefined>();

  // Re-fetch author details if the loader didn't provide them (transient OL
  // failure during the loader call).
  useEffect(() => {
    if (!validKey || details) {
      setDetailsLoading(false);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    void getAuthorDetails(authorKey).then((d) => {
      if (cancelled) return;
      setDetails(d);
      setDetailsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [authorKey, validKey, details]);

  useEffect(() => {
    if (!validKey) return;
    let cancelled = false;
    setWorksLoading(true);
    void getAuthorWorks(authorKey).then((rows) => {
      if (cancelled) return;
      const out: DisplayWork[] = [];
      const seen = new Set<string>();
      for (const r of rows) {
        const m = r.key.match(/^\/works\/(OL[A-Z0-9]+W)$/);
        if (!m) continue;
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({
          title: r.title,
          workId: m[1],
          firstPublishYear: r.firstPublishYear,
          coverId: r.coverId,
        });
      }
      setWorks(out);
      setWorksLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [authorKey, validKey]);

  // Stay in sync with the local follow list.
  useEffect(() => {
    const refresh = () => {
      const list = getAuthors();
      setFollowed(list.find((a) => a.olKey === authorKey));
    };
    refresh();
    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [authorKey]);

  if (!validKey) {
    return (
      <main className="min-h-screen py-8 px-4">
        <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-sm p-8 text-center">
          <Logo className="w-12 h-12 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
            Invalid author identifier
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            “{authorKey}” isn’t a recognized Open Library author key.
          </p>
          <Link
            to="/authors"
            className="inline-flex items-center text-sm text-amber-600 hover:text-amber-700"
          >
            ← Back to authors
          </Link>
        </div>
      </main>
    );
  }

  const photoUrl = details?.photoIds[0]
    ? `https://covers.openlibrary.org/a/id/${details.photoIds[0]}-L.jpg`
    : `https://covers.openlibrary.org/a/olid/${authorKey}-L.jpg`;

  const handleFollow = () => {
    if (followed || !details) return;
    addAuthor({ name: details.name, olKey: details.key });
    const list = getAuthors();
    setFollowed(list.find((a) => a.olKey === authorKey));
  };

  const handleUnfollow = () => {
    if (!followed) return;
    removeAuthor(followed.id);
    setFollowed(undefined);
  };

  const bio = details?.bio;
  const bioTooLong = !!bio && bio.length > 600;
  const visibleBio = bio && !bioExpanded && bioTooLong ? truncateMarkdown(bio, 600) : bio;

  return (
    <main className="min-h-screen py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Author hero */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
          <div className="p-5 sm:p-6 flex flex-col sm:flex-row gap-5">
            <div className="flex-shrink-0 mx-auto sm:mx-0">
              <AuthorPhoto src={photoUrl} alt={details?.name ?? authorKey} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                {details?.name ?? (detailsLoading ? "Loading…" : authorKey)}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                {details?.birthDate && (
                  <span>
                    {details.birthDate}
                    {details.deathDate ? ` – ${details.deathDate}` : ""}
                  </span>
                )}
                {!detailsLoading && works.length > 0 && (
                  <span>
                    {works.length} work{works.length !== 1 ? "s" : ""} on Open Library
                  </span>
                )}
              </div>
              {details?.alternateNames && details.alternateNames.length > 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Also known as: {details.alternateNames.join(", ")}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {followed ? (
                  <button
                    type="button"
                    onClick={handleUnfollow}
                    className="px-3 py-1.5 text-sm rounded-lg border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                  >
                    Following ✓
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleFollow}
                    disabled={!details}
                    className="px-3 py-1.5 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    Follow author
                  </button>
                )}
                <a
                  href={`https://openlibrary.org/authors/${authorKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Open Library ↗
                </a>
                {details?.wikipediaUrl && (
                  <a
                    href={details.wikipediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Wikipedia ↗
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Bio */}
          {bio && visibleBio && (
            <div className="px-5 sm:px-6 pb-5 border-t border-gray-100 dark:border-gray-700 pt-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">About</h2>
              <Markdown source={visibleBio} className="text-sm text-gray-700 dark:text-gray-300" />
              {bioTooLong && (
                <button
                  type="button"
                  onClick={() => setBioExpanded((s) => !s)}
                  className="mt-2 text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400"
                >
                  {bioExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* External links */}
        {details && details.links.length > 0 && (
          <section className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Links</h2>
            <ul className="flex flex-wrap gap-2">
              {details.links.map((l) => (
                <li key={l.url}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-amber-600 hover:text-amber-700 dark:text-amber-400"
                  >
                    {l.title} ↗
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Works */}
        <section className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Works</h2>
          {worksLoading && works.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading works…</p>
          )}
          {!worksLoading && works.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No works on file at Open Library.
            </p>
          )}
          {works.length > 0 && (
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {works.slice(0, 60).map((w) => (
                <li key={w.workId}>
                  <Link
                    to={`/book/${w.workId}`}
                    className="block group rounded-lg p-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <div className="flex gap-3 items-start">
                      {w.coverId ? (
                        <img
                          src={`https://covers.openlibrary.org/b/id/${w.coverId}-M.jpg`}
                          alt=""
                          className="w-12 aspect-[2/3] object-cover rounded flex-shrink-0"
                        />
                      ) : (
                        <div className="w-12 aspect-[2/3] bg-gray-100 dark:bg-gray-700 rounded flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white line-clamp-2 group-hover:text-amber-600 dark:group-hover:text-amber-400">
                          {w.title}
                        </p>
                        {w.firstPublishYear && (
                          <p className="text-xs text-gray-400 dark:text-gray-500">
                            {w.firstPublishYear}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function AuthorPhoto({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
        <svg
          className="w-16 h-16 text-purple-600 dark:text-purple-400"
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
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="w-32 h-32 sm:w-40 sm:h-40 rounded-full object-cover bg-gray-100 dark:bg-gray-700"
    />
  );
}
