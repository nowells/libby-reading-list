import { Link, useParams, redirect } from "react-router";
import { useEffect, useMemo, useState } from "react";
import {
  getBooks,
  getLibraries,
  getReadBooks,
  getAuthors,
  addBook,
  updateBook,
  removeBook,
  addReadBook,
  removeReadBook,
  addAuthor,
  readBookKey,
  type Book,
  type LibraryConfig,
} from "~/lib/storage";
import {
  getWorkDetails,
  getWorkRatings,
  getWorkEditionSummary,
  searchSeriesBooks,
  type WorkDetails,
  type WorkRatings,
  type SeriesBook,
} from "~/lib/openlibrary";
import { CoverImage } from "~/components/cover-image";
import { FormatIcon } from "~/components/format-icon";
import { LibraryIcon, LibraryName } from "~/components/library-icon";
import { Logo } from "~/components/logo";
import { Markdown, truncateMarkdown } from "~/components/markdown";
import { findBookInLibrary, type BookAvailability } from "~/lib/libby";
import { libbyTitleUrl } from "~/routes/books/lib/utils";
import { EtaBadge } from "~/routes/books/components/eta-badge";

export function meta({ params }: { params: { workId?: string } }) {
  return [{ title: `Book ${params.workId ?? ""} | ShelfCheck` }];
}

export function clientLoader() {
  const libraries = getLibraries();
  if (libraries.length === 0) {
    throw redirect("/setup");
  }
  return { libraries };
}

interface EditionSummary {
  pageCount?: number;
  publishers: string[];
  earliestPublishYear?: number;
  totalEditions: number;
  languages: string[];
}

function StarBar({ rating }: { rating: number }) {
  // 0-5 scale with half-star precision
  const full = Math.floor(rating);
  const hasHalf = rating - full >= 0.25 && rating - full < 0.75;
  const showFull = rating - full >= 0.75 ? full + 1 : full;
  const slots = ["s1", "s2", "s3", "s4", "s5"] as const;
  return (
    <span className="inline-flex gap-0.5">
      {slots.map((slot, i) => {
        if (i < showFull) {
          return (
            <svg
              key={slot}
              className="w-4 h-4 text-amber-400"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          );
        }
        if (i === showFull && hasHalf) {
          return (
            <svg
              key={slot}
              className="w-4 h-4 text-amber-400"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-label="half star"
            >
              <defs>
                <linearGradient id={`half-${slot}`}>
                  <stop offset="50%" stopColor="currentColor" />
                  <stop offset="50%" stopColor="rgb(229 231 235 / 1)" />
                </linearGradient>
              </defs>
              <path
                fill={`url(#half-${slot})`}
                d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
              />
            </svg>
          );
        }
        return (
          <svg
            key={slot}
            className="w-4 h-4 text-gray-300 dark:text-gray-600"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
        );
      })}
    </span>
  );
}

function findExistingBook(workId: string): Book | undefined {
  return getBooks().find((b) => b.workId === workId);
}

function findReadEntry(workId: string, title: string, author: string) {
  const key = readBookKey({ workId, title, author });
  return getReadBooks().find((r) => r.key === key);
}

function isAuthorFollowed(name: string): boolean {
  const lower = name.toLowerCase();
  return getAuthors().some((a) => a.name.toLowerCase() === lower);
}

export default function BookDetails() {
  const params = useParams<{ workId: string }>();
  const workId = params.workId ?? "";
  const validWorkId = /^OL[A-Z0-9]+W$/.test(workId);
  const libraries = useMemo<LibraryConfig[]>(() => getLibraries(), []);

  const [details, setDetails] = useState<WorkDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [ratings, setRatings] = useState<WorkRatings | null>(null);
  const [edSummary, setEdSummary] = useState<EditionSummary | null>(null);
  const [series, setSeries] = useState<SeriesBook[]>([]);
  const [seriesName, setSeriesName] = useState<string | null>(null);
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({});
  const [availability, setAvailability] = useState<BookAvailability | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  const [existingBook, setExistingBook] = useState<Book | undefined>(() =>
    validWorkId ? findExistingBook(workId) : undefined,
  );
  const [isRead, setIsRead] = useState(false);
  const [authorFollowed, setAuthorFollowed] = useState(false);

  // Local fallback so the page can render before Open Library responds.
  const fallbackTitle = existingBook?.canonicalTitle ?? existingBook?.title;
  const fallbackAuthor = existingBook?.canonicalAuthor ?? existingBook?.author;
  const displayTitle = details?.title ?? fallbackTitle ?? "Loading…";
  const displayAuthor =
    details?.authors[0]?.name && authorNames[details.authors[0].key]
      ? authorNames[details.authors[0].key]
      : (fallbackAuthor ?? "Unknown author");
  const primaryAuthorKey = details?.authors[0]?.key;

  // Initial fetch — work details (description, subjects, etc.)
  useEffect(() => {
    if (!validWorkId) {
      setDetailsLoading(false);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    void getWorkDetails(workId).then((d) => {
      if (cancelled) return;
      setDetails(d);
      setDetailsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [workId, validWorkId]);

  // Fetch ratings + edition summary + author names in parallel
  useEffect(() => {
    if (!validWorkId) return;
    let cancelled = false;
    void getWorkRatings(workId).then((r) => {
      if (!cancelled) setRatings(r);
    });
    void getWorkEditionSummary(workId).then((s) => {
      if (!cancelled) setEdSummary(s);
    });
    return () => {
      cancelled = true;
    };
  }, [workId, validWorkId]);

  // Resolve author names from author keys for display + linking
  useEffect(() => {
    if (!details?.authors.length) return;
    let cancelled = false;
    (async () => {
      const out: Record<string, string> = {};
      await Promise.all(
        details.authors.map(async (a) => {
          try {
            const res = await fetch(`https://openlibrary.org/authors/${a.key}.json`, {
              headers: { Accept: "application/json" },
            });
            if (!res.ok) return;
            const j = (await res.json()) as { name?: string };
            if (typeof j.name === "string") out[a.key] = j.name;
          } catch {
            // ignore
          }
        }),
      );
      if (!cancelled) setAuthorNames(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [details]);

  // Fetch Libby availability once we know the title + author
  useEffect(() => {
    if (!validWorkId) return;
    if (libraries.length === 0) return;
    const title = details?.title ?? fallbackTitle;
    const author =
      authorNames[primaryAuthorKey ?? ""] ?? details?.authors[0]?.name ?? fallbackAuthor;
    if (!title || !author) return;
    let cancelled = false;
    setAvailLoading(true);
    (async () => {
      try {
        const all = await Promise.all(
          libraries.map((lib) =>
            findBookInLibrary(lib.key, title, author, {
              primaryIsbn: existingBook?.isbn13,
            }).catch(
              () =>
                ({
                  bookTitle: title,
                  bookAuthor: author,
                  results: [],
                }) as BookAvailability,
            ),
          ),
        );
        if (cancelled) return;
        const merged: BookAvailability = {
          bookTitle: title,
          bookAuthor: author,
          results: all.flatMap((a) => a.results),
        };
        for (const a of all) {
          if (a.coverUrl && !merged.coverUrl) merged.coverUrl = a.coverUrl;
          if (a.seriesInfo && !merged.seriesInfo) merged.seriesInfo = a.seriesInfo;
        }
        setAvailability(merged);
        if (merged.seriesInfo?.seriesName) {
          setSeriesName(merged.seriesInfo.seriesName);
        }
      } finally {
        if (!cancelled) setAvailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    validWorkId,
    libraries,
    details,
    fallbackTitle,
    fallbackAuthor,
    primaryAuthorKey,
    authorNames,
    existingBook?.isbn13,
  ]);

  // Once we have a series name (from Libby), pull related books from OL
  useEffect(() => {
    if (!seriesName) return;
    let cancelled = false;
    void searchSeriesBooks(seriesName).then((books) => {
      if (!cancelled) setSeries(books.filter((b) => b.workId !== workId));
    });
    return () => {
      cancelled = true;
    };
  }, [seriesName, workId]);

  // Recompute local-state flags when work / display info shifts.
  useEffect(() => {
    if (!validWorkId) return;
    setExistingBook(findExistingBook(workId));
    if (displayTitle && displayAuthor) {
      const r = findReadEntry(workId, displayTitle, displayAuthor);
      setIsRead(!!r);
    }
    if (displayAuthor) {
      setAuthorFollowed(isAuthorFollowed(displayAuthor));
    }
  }, [workId, validWorkId, displayTitle, displayAuthor]);

  if (!validWorkId) {
    return (
      <main className="min-h-screen py-8 px-4">
        <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-sm p-8 text-center">
          <Logo className="w-12 h-12 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
            Invalid book identifier
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            “{workId}” isn’t a recognized Open Library work ID.
          </p>
          <Link
            to="/books"
            className="inline-flex items-center text-sm text-amber-600 hover:text-amber-700"
          >
            ← Back to your books
          </Link>
        </div>
      </main>
    );
  }

  const coverUrl =
    availability?.coverUrl ??
    existingBook?.imageUrl ??
    (details?.coverIds[0]
      ? `https://covers.openlibrary.org/b/id/${details.coverIds[0]}-L.jpg`
      : existingBook?.isbn13
        ? `https://covers.openlibrary.org/b/isbn/${existingBook.isbn13}-L.jpg`
        : undefined);

  const subjects = details?.subjects ?? [];

  const handleAddToReadingList = () => {
    if (existingBook) return;
    addBook({
      title: displayTitle,
      author: displayAuthor,
      source: "unknown",
      workId,
      canonicalTitle: details?.title,
      canonicalAuthor: authorNames[primaryAuthorKey ?? ""] ?? details?.authors[0]?.name,
      subjects: details?.subjects,
      pageCount: edSummary?.pageCount,
      firstPublishYear: details?.firstPublishYear,
      imageUrl: coverUrl,
      status: "wantToRead",
    });
    setExistingBook(findExistingBook(workId));
  };

  const handleRemoveFromList = () => {
    if (!existingBook) return;
    removeBook(existingBook.id);
    setExistingBook(undefined);
  };

  const handleToggleRead = () => {
    const key = readBookKey({ workId, title: displayTitle, author: displayAuthor });
    if (isRead) {
      removeReadBook(key);
      setIsRead(false);
      // If the local book is finished, set it back to wantToRead. But if the
      // book is only tracked through the read-entry, removeReadBook already
      // cleared the source of truth.
      if (existingBook?.status === "finished") {
        updateBook(existingBook.id, { status: "wantToRead", finishedAt: undefined });
      }
    } else {
      addReadBook({ key, title: displayTitle, author: displayAuthor, workId });
      setIsRead(true);
      if (existingBook) {
        updateBook(existingBook.id, {
          status: "finished",
          finishedAt: new Date().toISOString(),
        });
      }
    }
  };

  const handleFollowAuthor = () => {
    if (authorFollowed) return;
    addAuthor({
      name: displayAuthor,
      olKey: primaryAuthorKey,
    });
    setAuthorFollowed(true);
  };

  const description = details?.description;
  const descTooLong = !!description && description.length > 480;
  const visibleDesc =
    description && !descExpanded && descTooLong ? truncateMarkdown(description, 480) : description;

  return (
    <main className="min-h-screen py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header / nav */}
        <div className="mb-6 flex items-center gap-3">
          <Link to="/books" className="flex items-center gap-2">
            <Logo className="w-9 h-9 flex-shrink-0" />
          </Link>
          <Link
            to="/books"
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ← Back to books
          </Link>
        </div>

        {/* Book hero */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
          <div className="p-5 sm:p-6 flex flex-col sm:flex-row gap-5">
            {/* Cover */}
            <div className="flex-shrink-0 mx-auto sm:mx-0">
              {coverUrl ? (
                // Use the existing cover-image fallback behavior, but at hero size.
                <img
                  src={coverUrl}
                  alt={displayTitle}
                  className="w-32 sm:w-40 aspect-[2/3] object-cover rounded-lg shadow"
                />
              ) : (
                <div className="w-32 sm:w-40 aspect-[2/3] rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <CoverImage src={undefined} alt={displayTitle} />
                </div>
              )}
            </div>

            {/* Title block */}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                {displayTitle}
              </h1>
              {details?.subtitle && (
                <p className="text-base text-gray-600 dark:text-gray-300 mt-1">
                  {details.subtitle}
                </p>
              )}
              <p className="text-base text-gray-600 dark:text-gray-400 mt-1">
                by{" "}
                {primaryAuthorKey ? (
                  <Link
                    to={`/author/${primaryAuthorKey}`}
                    className="text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                  >
                    {displayAuthor}
                  </Link>
                ) : (
                  <span>{displayAuthor}</span>
                )}
                {details?.authors.length && details.authors.length > 1 && (
                  <span className="text-gray-400 dark:text-gray-500">
                    {" "}
                    + {details.authors.length - 1} more
                  </span>
                )}
              </p>

              {/* Quick metadata row */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                {details?.firstPublishYear && (
                  <span>First published {details.firstPublishYear}</span>
                )}
                {edSummary?.pageCount && <span>{edSummary.pageCount} pages</span>}
                {edSummary?.totalEditions ? (
                  <span>
                    {edSummary.totalEditions} edition{edSummary.totalEditions !== 1 ? "s" : ""}
                  </span>
                ) : null}
                {ratings?.average !== undefined && (
                  <span className="inline-flex items-center gap-1.5">
                    <StarBar rating={ratings.average} />
                    <span className="tabular-nums">
                      {ratings.average.toFixed(2)}
                      {ratings.count > 0 && (
                        <span className="text-gray-400"> ({ratings.count})</span>
                      )}
                    </span>
                  </span>
                )}
              </div>

              {availability?.seriesInfo && (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  Book {availability.seriesInfo.readingOrder} in{" "}
                  <span className="italic">{availability.seriesInfo.seriesName}</span>
                </p>
              )}

              {/* Action buttons */}
              <div className="mt-4 flex flex-wrap gap-2">
                {existingBook ? (
                  <button
                    type="button"
                    onClick={handleRemoveFromList}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Remove from list
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleAddToReadingList}
                    className="px-3 py-1.5 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                  >
                    Want to read
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleToggleRead}
                  className={`px-3 py-1.5 text-sm rounded-lg border ${
                    isRead
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-300"
                      : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {isRead ? "Read ✓" : "Mark as read"}
                </button>
                {primaryAuthorKey && !authorFollowed && (
                  <button
                    type="button"
                    onClick={handleFollowAuthor}
                    className="px-3 py-1.5 text-sm rounded-lg border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                  >
                    Follow author
                  </button>
                )}
                <a
                  href={`https://openlibrary.org/works/${workId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Open Library ↗
                </a>
              </div>
            </div>
          </div>

          {/* Description */}
          {description && visibleDesc && (
            <div className="px-5 sm:px-6 pb-5 border-t border-gray-100 dark:border-gray-700 pt-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                Description
              </h2>
              <Markdown source={visibleDesc} className="text-sm text-gray-700 dark:text-gray-300" />
              {descTooLong && (
                <button
                  type="button"
                  onClick={() => setDescExpanded((s) => !s)}
                  className="mt-2 text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400"
                >
                  {descExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}

          {!description && detailsLoading && (
            <div className="px-5 sm:px-6 pb-5 border-t border-gray-100 dark:border-gray-700 pt-4">
              <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded mb-2 animate-pulse" />
              <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded mb-2 animate-pulse w-5/6" />
              <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded animate-pulse w-2/3" />
            </div>
          )}
        </div>

        {/* Genres / Subjects */}
        {subjects.length > 0 && (
          <section className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              Genres &amp; subjects
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {subjects.slice(0, 25).map((s) => (
                <span
                  key={s}
                  className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  {s}
                </span>
              ))}
            </div>
            {(details?.subjectPlaces?.length ||
              details?.subjectPeople?.length ||
              details?.subjectTimes?.length) && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                {details?.subjectPlaces && details.subjectPlaces.length > 0 && (
                  <div>
                    <p className="text-gray-400 dark:text-gray-500 mb-1">Places</p>
                    <p className="text-gray-700 dark:text-gray-300">
                      {details.subjectPlaces.join(", ")}
                    </p>
                  </div>
                )}
                {details?.subjectPeople && details.subjectPeople.length > 0 && (
                  <div>
                    <p className="text-gray-400 dark:text-gray-500 mb-1">People</p>
                    <p className="text-gray-700 dark:text-gray-300">
                      {details.subjectPeople.join(", ")}
                    </p>
                  </div>
                )}
                {details?.subjectTimes && details.subjectTimes.length > 0 && (
                  <div>
                    <p className="text-gray-400 dark:text-gray-500 mb-1">Time periods</p>
                    <p className="text-gray-700 dark:text-gray-300">
                      {details.subjectTimes.join(", ")}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Library availability */}
        <section className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
            At your libraries
          </h2>
          {availLoading && !availability && (
            <p className="text-sm text-gray-500 dark:text-gray-400">Checking Libby…</p>
          )}
          {!availLoading && availability && availability.results.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Not found at any of your configured libraries.
            </p>
          )}
          {availability && availability.results.length > 0 && (
            <div className="space-y-1">
              {availability.results.map((r) => {
                const preferredKey =
                  libraries.find((l) => l.key === r.libraryKey)?.preferredKey ?? r.libraryKey;
                return (
                  <a
                    key={`${r.libraryKey}-${r.mediaItem.id}`}
                    href={libbyTitleUrl(preferredKey, r.mediaItem.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-sm"
                  >
                    <span className="text-gray-500 dark:text-gray-400 [&_svg]:w-4 [&_svg]:h-4">
                      <FormatIcon type={r.formatType} />
                    </span>
                    <span className="flex items-center gap-2 min-w-0 flex-1">
                      <LibraryIcon libraryKey={r.libraryKey} libraries={libraries} />
                      <span className="truncate text-gray-700 dark:text-gray-200">
                        <LibraryName libraryKey={r.libraryKey} libraries={libraries} />
                      </span>
                    </span>
                    <span
                      className={`text-xs tabular-nums ${
                        r.availability.numberOfHolds > 100
                          ? "text-red-500"
                          : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {r.availability.isAvailable
                        ? "0 holds"
                        : `${r.availability.numberOfHolds} holds`}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                      {r.availability.copiesAvailable}/{r.availability.copiesOwned}
                    </span>
                    <span className="text-xs">
                      {r.availability.isAvailable ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          Now
                        </span>
                      ) : (
                        <EtaBadge days={r.availability.estimatedWaitDays} />
                      )}
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        {/* Edition / publishing details */}
        {edSummary && edSummary.totalEditions > 0 && (
          <section className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              Publishing details
            </h2>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              {edSummary.pageCount && (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-gray-500">Median length</dt>
                  <dd className="text-gray-900 dark:text-gray-100">{edSummary.pageCount} pages</dd>
                </div>
              )}
              {edSummary.earliestPublishYear && (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-gray-500">First published</dt>
                  <dd className="text-gray-900 dark:text-gray-100">
                    {edSummary.earliestPublishYear}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-gray-400 dark:text-gray-500">Editions</dt>
                <dd className="text-gray-900 dark:text-gray-100">{edSummary.totalEditions}</dd>
              </div>
              {edSummary.languages.length > 0 && (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-gray-500">Languages</dt>
                  <dd className="text-gray-900 dark:text-gray-100 uppercase tracking-wide">
                    {edSummary.languages.slice(0, 3).join(", ")}
                  </dd>
                </div>
              )}
              {edSummary.publishers.length > 0 && (
                <div className="col-span-2 sm:col-span-4">
                  <dt className="text-xs text-gray-400 dark:text-gray-500">Publishers</dt>
                  <dd className="text-gray-900 dark:text-gray-100">
                    {edSummary.publishers.join(" · ")}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {/* Series */}
        {seriesName && series.length > 0 && (
          <section className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              More in <span className="italic">{seriesName}</span>
            </h2>
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {series.slice(0, 12).map((b) => (
                <li key={b.workId}>
                  <Link
                    to={`/book/${b.workId}`}
                    className="block group rounded-lg p-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <div className="flex gap-3 items-start">
                      {b.coverId ? (
                        <img
                          src={`https://covers.openlibrary.org/b/id/${b.coverId}-M.jpg`}
                          alt=""
                          className="w-12 aspect-[2/3] object-cover rounded flex-shrink-0"
                        />
                      ) : (
                        <div className="w-12 aspect-[2/3] bg-gray-100 dark:bg-gray-700 rounded flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white line-clamp-2 group-hover:text-amber-600 dark:group-hover:text-amber-400">
                          {b.title}
                        </p>
                        {b.authorName && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {b.authorName}
                          </p>
                        )}
                        {b.firstPublishYear && (
                          <p className="text-xs text-gray-400 dark:text-gray-500">
                            {b.firstPublishYear}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Other authors */}
        {details && details.authors.length > 1 && (
          <section className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Authors</h2>
            <ul className="flex flex-wrap gap-2">
              {details.authors.map((a) => (
                <li key={a.key}>
                  <Link
                    to={`/author/${a.key}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 text-sm hover:bg-purple-100 dark:hover:bg-purple-900/40"
                  >
                    {authorNames[a.key] ?? a.key}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

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
                    className="text-sm text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                  >
                    {l.title} ↗
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
