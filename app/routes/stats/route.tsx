import { Link, redirect } from "react-router";
import { useState, useEffect, useMemo } from "react";
import { getBooks, getLibraries, getAuthors, type Book, type LibraryConfig } from "~/lib/storage";
import { getWorkMetadata } from "~/lib/openlibrary";
import { updateBook } from "~/lib/storage";
import { Logo } from "~/components/logo";
import { readCache } from "~/routes/books/lib/cache";
import { categorizeBook, type BookCategory } from "~/routes/books/lib/categorize";

export function meta() {
  return [{ title: "Stats | ShelfCheck" }];
}

export function clientLoader() {
  const libraries = getLibraries();
  if (libraries.length === 0) {
    throw redirect("/setup");
  }
  return { libraries };
}

// --- Visualization components ---

/** Horizontal bar with label, count, and percentage fill */
function StatBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 dark:text-gray-400 w-24 text-right truncate">
        {label}
      </span>
      <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 overflow-hidden relative">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
        />
        {count > 0 && (
          <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-gray-700 dark:text-gray-200">
            {count}
          </span>
        )}
      </div>
      <span className="text-xs text-gray-400 dark:text-gray-500 w-10 tabular-nums">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

/** Donut-style ring chart using CSS conic-gradient */
function DonutChart({
  segments,
  size = 120,
  label,
}: {
  segments: { value: number; color: string; label: string }[];
  size?: number;
  label?: string;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  let cumPct = 0;
  const stops: string[] = [];
  for (const seg of segments) {
    const pct = (seg.value / total) * 100;
    stops.push(`${seg.color} ${cumPct}% ${cumPct + pct}%`);
    cumPct += pct;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="rounded-full relative"
        style={{
          width: size,
          height: size,
          background: `conic-gradient(${stops.join(", ")})`,
        }}
      >
        <div
          className="absolute bg-white dark:bg-gray-800 rounded-full flex items-center justify-center"
          style={{
            top: size * 0.2,
            left: size * 0.2,
            width: size * 0.6,
            height: size * 0.6,
          }}
        >
          <span className="text-lg font-bold text-gray-700 dark:text-gray-200">{total}</span>
        </div>
      </div>
      {label && (
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{label}</span>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span
              key={s.label}
              className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400"
            >
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ backgroundColor: s.color }}
              />
              {s.label} ({s.value})
            </span>
          ))}
      </div>
    </div>
  );
}

/** Simple vertical bar chart */
function BarChart({
  data,
  color,
  maxBars = 20,
}: {
  data: { label: string; value: number }[];
  color: string;
  maxBars?: number;
}) {
  const sliced = data.slice(0, maxBars);
  const max = Math.max(...sliced.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1 h-32">
      {sliced.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <span className="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums">
            {d.value}
          </span>
          <div
            className={`w-full rounded-t ${color} transition-all duration-300`}
            style={{ height: `${(d.value / max) * 80}%`, minHeight: d.value > 0 ? 4 : 0 }}
          />
          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate w-full text-center">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Card wrapper for stat sections */
function StatCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">{title}</h3>
      {children}
    </div>
  );
}

/** Big number stat */
function BigStat({ value, label, sub }: { value: string | number; label: string; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold text-gray-800 dark:text-gray-100">{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500">{sub}</div>}
    </div>
  );
}

// --- Helpers ---

const SOURCE_LABELS: Record<string, string> = {
  goodreads: "Goodreads",
  hardcover: "Hardcover",
  storygraph: "StoryGraph",
  bookhive: "Bookhive",
  lyndi: "Lyndi CSV",
  unknown: "Other",
};

const SOURCE_COLORS: Record<string, string> = {
  goodreads: "#6366f1",
  hardcover: "#f59e0b",
  storygraph: "#ec4899",
  bookhive: "#06b6d4",
  lyndi: "#8b5cf6",
  unknown: "#9ca3af",
};

const AVAIL_COLORS: Record<string, string> = {
  available: "#10b981",
  soon: "#3b82f6",
  waiting: "#f59e0b",
  not_found: "#f43f5e",
  pending: "#d1d5db",
};

const AVAIL_LABELS: Record<string, string> = {
  available: "Available Now",
  soon: "Coming Soon",
  waiting: "Long Wait",
  not_found: "Not Found",
  pending: "Pending",
};

/** Normalize OL subjects into cleaner genre buckets */
function normalizeGenre(subject: string): string {
  const s = subject.toLowerCase().trim();
  // Map common OL subject variants to clean genre names
  const mappings: [RegExp, string][] = [
    [/^fiction$/i, "Fiction"],
    [/literary fiction|general fiction/i, "Fiction"],
    [/science fiction|sci-fi/i, "Science Fiction"],
    [/fantasy/i, "Fantasy"],
    [/mystery|detective/i, "Mystery"],
    [/thriller|suspense/i, "Thriller"],
    [/romance/i, "Romance"],
    [/horror/i, "Horror"],
    [/historical fiction/i, "Historical Fiction"],
    [/history/i, "History"],
    [/biography|autobiography|memoir/i, "Biography & Memoir"],
    [/self-help|self help|personal development/i, "Self-Help"],
    [/business|management|leadership/i, "Business"],
    [/science$/i, "Science"],
    [/psychology/i, "Psychology"],
    [/philosophy/i, "Philosophy"],
    [/poetry/i, "Poetry"],
    [/children|juvenile/i, "Children's"],
    [/young adult|ya /i, "Young Adult"],
    [/comic|graphic novel/i, "Comics & Graphic Novels"],
    [/cooking|food|recipes/i, "Cooking"],
    [/travel/i, "Travel"],
    [/art$/i, "Art"],
    [/music/i, "Music"],
    [/religion|spirituality/i, "Religion & Spirituality"],
    [/politics|political/i, "Politics"],
    [/technology|computer|programming/i, "Technology"],
    [/nature|environment/i, "Nature"],
    [/adventure/i, "Adventure"],
    [/crime/i, "Crime"],
    [/war|military/i, "War & Military"],
    [/humor|comedy|funny/i, "Humor"],
    [/drama/i, "Drama"],
    [/nonfiction|non-fiction/i, "Nonfiction"],
    [/education|teaching/i, "Education"],
    [/economics/i, "Economics"],
    [/sociology|social/i, "Social Science"],
    [/literature/i, "Literature"],
  ];
  for (const [re, label] of mappings) {
    if (re.test(s)) return label;
  }
  // Title-case the raw subject
  return subject
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Decade bucket label (e.g. "2020s") */
function decadeLabel(year: number): string {
  const decade = Math.floor(year / 10) * 10;
  return `${decade}s`;
}

// --- Main component ---

export default function Stats() {
  const [books] = useState<Book[]>(() => getBooks());
  const [libraries] = useState<LibraryConfig[]>(() => getLibraries());
  const [authors] = useState(() => getAuthors());
  const [metaProgress, setMetaProgress] = useState<{ done: number; total: number } | null>(null);

  // Fetch missing work metadata on mount
  useEffect(() => {
    const needsMeta = books.filter((b) => b.workId && !b.subjects);
    if (needsMeta.length === 0) return;

    const cancelledRef = { current: false };
    setMetaProgress({ done: 0, total: needsMeta.length });

    (async () => {
      let done = 0;
      const CONCURRENCY = 4;
      let idx = 0;

      async function worker() {
        while (idx < needsMeta.length && !cancelledRef.current) {
          const book = needsMeta[idx++];
          const workMeta = await getWorkMetadata(book.workId!);
          if (workMeta && !cancelledRef.current) {
            const updates: Partial<Book> = {};
            if (workMeta.subjects.length > 0) updates.subjects = workMeta.subjects;
            if (workMeta.firstPublishYear) updates.firstPublishYear = workMeta.firstPublishYear;
            if (Object.keys(updates).length > 0) {
              updateBook(book.id, updates);
            }
          }
          done++;
          if (!cancelledRef.current) setMetaProgress({ done, total: needsMeta.length });
        }
      }

      const workers = Array.from({ length: Math.min(CONCURRENCY, needsMeta.length) }, worker);
      await Promise.all(workers);
      if (!cancelledRef.current) setMetaProgress(null);
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Read fresh books after metadata fetch completes
  const currentBooks = useMemo(() => {
    if (metaProgress === null && books.some((b) => b.workId && !b.subjects)) {
      return getBooks();
    }
    return books;
  }, [books, metaProgress]);

  // Read availability cache
  const availCache = useMemo(() => readCache(), []);

  // --- Compute all stats ---

  const stats = useMemo(() => {
    const total = currentBooks.length;

    // Source breakdown
    const bySrc: Record<string, number> = {};
    for (const b of currentBooks) {
      bySrc[b.source] = (bySrc[b.source] ?? 0) + 1;
    }

    // Availability breakdown
    const byAvail: Record<string, number> = {
      available: 0,
      soon: 0,
      waiting: 0,
      not_found: 0,
      pending: 0,
    };
    const waitDays: number[] = [];
    let totalHolds = 0;
    let totalCopies = 0;
    let ebookCount = 0;
    let audiobookCount = 0;
    const formatByBook: Record<string, Set<string>> = {};

    for (const b of currentBooks) {
      const entry = availCache[b.id];
      const state = entry
        ? { status: "done" as const, data: entry.data, fetchedAt: entry.fetchedAt }
        : undefined;
      const cat = categorizeBook(state);
      byAvail[cat]++;

      if (entry?.data) {
        for (const r of entry.data.results) {
          if (!formatByBook[b.id]) formatByBook[b.id] = new Set();
          if (r.formatType.includes("ebook")) {
            formatByBook[b.id].add("ebook");
            ebookCount++;
          }
          if (r.formatType.includes("audiobook")) {
            formatByBook[b.id].add("audiobook");
            audiobookCount++;
          }
          totalHolds += r.availability.numberOfHolds;
          totalCopies += r.availability.copiesOwned;
          if (r.availability.estimatedWaitDays != null) {
            waitDays.push(r.availability.estimatedWaitDays);
          }
        }
      }
    }

    const avgWait = waitDays.length > 0 ? waitDays.reduce((a, b) => a + b, 0) / waitDays.length : 0;
    const medianWait =
      waitDays.length > 0
        ? (() => {
            const sorted = [...waitDays].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
          })()
        : 0;

    // Enrichment stats
    const withWorkId = currentBooks.filter((b) => b.workId).length;
    const withIsbn = currentBooks.filter((b) => b.isbn13).length;
    const withSubjects = currentBooks.filter((b) => b.subjects && b.subjects.length > 0).length;
    const withYear = currentBooks.filter((b) => b.firstPublishYear).length;
    const manualCount = currentBooks.filter((b) => b.manual).length;

    // Genre distribution
    const genreCounts: Record<string, number> = {};
    for (const b of currentBooks) {
      if (!b.subjects) continue;
      const seen = new Set<string>();
      for (const raw of b.subjects) {
        const genre = normalizeGenre(raw);
        if (seen.has(genre)) continue;
        seen.add(genre);
        genreCounts[genre] = (genreCounts[genre] ?? 0) + 1;
      }
    }
    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    // Decade distribution
    const decadeCounts: Record<string, number> = {};
    for (const b of currentBooks) {
      if (!b.firstPublishYear) continue;
      const dec = decadeLabel(b.firstPublishYear);
      decadeCounts[dec] = (decadeCounts[dec] ?? 0) + 1;
    }
    const decades = Object.entries(decadeCounts).sort((a, b) => a[0].localeCompare(b[0]));

    // Author frequency
    const authorCounts: Record<string, number> = {};
    for (const b of currentBooks) {
      const name = b.canonicalAuthor ?? b.author;
      if (!name) continue;
      authorCounts[name] = (authorCounts[name] ?? 0) + 1;
    }
    const topAuthors = Object.entries(authorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Books with both ebook + audiobook
    const bothFormats = Object.values(formatByBook).filter(
      (s) => s.has("ebook") && s.has("audiobook"),
    ).length;
    const ebookOnly = Object.values(formatByBook).filter(
      (s) => s.has("ebook") && !s.has("audiobook"),
    ).length;
    const audioOnly = Object.values(formatByBook).filter(
      (s) => !s.has("ebook") && s.has("audiobook"),
    ).length;

    // Wait time distribution buckets
    const waitBuckets = [
      { label: "Now", min: -1, max: 0 },
      { label: "1-7d", min: 1, max: 7 },
      { label: "8-14d", min: 8, max: 14 },
      { label: "15-30d", min: 15, max: 30 },
      { label: "31-60d", min: 31, max: 60 },
      { label: "60d+", min: 61, max: Infinity },
    ];
    const waitDistribution = waitBuckets.map((bucket) => ({
      label: bucket.label,
      value:
        bucket.max === 0
          ? byAvail.available
          : waitDays.filter((d) => d >= bucket.min && d <= bucket.max).length,
    }));

    return {
      total,
      bySrc,
      byAvail,
      avgWait,
      medianWait,
      totalHolds,
      totalCopies,
      ebookCount,
      audiobookCount,
      withWorkId,
      withIsbn,
      withSubjects,
      withYear,
      manualCount,
      topGenres,
      decades,
      topAuthors,
      bothFormats,
      ebookOnly,
      audioOnly,
      waitDistribution,
    };
  }, [currentBooks, availCache]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-950 dark:to-gray-900 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <Logo className="w-9 h-9 flex-shrink-0" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex-1 min-w-0 truncate">
              Library Stats
            </h1>
            <div className="flex items-center gap-3 flex-shrink-0">
              <Link
                to="/books"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
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
                <span className="hidden sm:inline">Books</span>
              </Link>
              <Link
                to="/authors"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
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
                <span className="hidden sm:inline">Authors</span>
              </Link>
              <Link
                to="/setup"
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
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
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                <span className="hidden sm:inline">Settings</span>
              </Link>
            </div>
          </div>
          <p className="mt-1 sm:ml-12 text-sm text-gray-500 dark:text-gray-400">
            {stats.total} books &middot; {libraries.length}{" "}
            {libraries.length === 1 ? "library" : "libraries"}
            {authors.length > 0 && (
              <>
                {" "}
                &middot; {authors.length} {authors.length === 1 ? "author" : "authors"}
              </>
            )}
          </p>
        </div>

        {/* Metadata loading indicator */}
        {metaProgress && (
          <div className="mb-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Fetching metadata from Open Library... {metaProgress.done}/{metaProgress.total}
              </span>
              <span className="text-xs text-gray-400 tabular-nums">
                {Math.round((metaProgress.done / metaProgress.total) * 100)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
              <div
                className="bg-purple-500 h-1.5 rounded-full transition-all"
                style={{ width: `${(metaProgress.done / metaProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Overview numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <BigStat value={stats.total} label="Total Books" />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <BigStat
              value={stats.byAvail.available}
              label="Available Now"
              sub={`${stats.total > 0 ? ((stats.byAvail.available / stats.total) * 100).toFixed(0) : 0}% of library`}
            />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <BigStat
              value={`${Math.round(stats.medianWait)}d`}
              label="Median Wait"
              sub={`avg ${Math.round(stats.avgWait)}d`}
            />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <BigStat
              value={stats.topAuthors.length > 0 ? stats.topAuthors[0][1] : 0}
              label="Most by Author"
              sub={stats.topAuthors.length > 0 ? stats.topAuthors[0][0] : ""}
            />
          </div>
        </div>

        {/* Main stats grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Availability */}
          <StatCard title="Availability Breakdown">
            <DonutChart
              segments={[
                {
                  value: stats.byAvail.available,
                  color: AVAIL_COLORS.available,
                  label: "Available",
                },
                { value: stats.byAvail.soon, color: AVAIL_COLORS.soon, label: "Soon" },
                { value: stats.byAvail.waiting, color: AVAIL_COLORS.waiting, label: "Waiting" },
                {
                  value: stats.byAvail.not_found,
                  color: AVAIL_COLORS.not_found,
                  label: "Not Found",
                },
                { value: stats.byAvail.pending, color: AVAIL_COLORS.pending, label: "Pending" },
              ]}
              label="Books"
            />
          </StatCard>

          {/* Import sources */}
          <StatCard title="Import Sources">
            <DonutChart
              segments={Object.entries(stats.bySrc).map(([src, count]) => ({
                value: count,
                color: SOURCE_COLORS[src] ?? "#9ca3af",
                label: SOURCE_LABELS[src] ?? src,
              }))}
              label="Books"
            />
          </StatCard>

          {/* Wait time distribution */}
          <StatCard title="Wait Time Distribution">
            <BarChart data={stats.waitDistribution} color="bg-blue-400 dark:bg-blue-500" />
          </StatCard>

          {/* Format availability */}
          <StatCard title="Format Availability">
            <div className="space-y-3">
              <StatBar
                label="Both formats"
                count={stats.bothFormats}
                total={stats.total}
                color="bg-emerald-400"
              />
              <StatBar
                label="Ebook only"
                count={stats.ebookOnly}
                total={stats.total}
                color="bg-blue-400"
              />
              <StatBar
                label="Audio only"
                count={stats.audioOnly}
                total={stats.total}
                color="bg-purple-400"
              />
              <StatBar
                label="Not in library"
                count={stats.total - stats.bothFormats - stats.ebookOnly - stats.audioOnly}
                total={stats.total}
                color="bg-gray-300 dark:bg-gray-600"
              />
            </div>
          </StatCard>

          {/* Top genres */}
          {stats.topGenres.length > 0 && (
            <StatCard title="Top Genres" className="md:col-span-2">
              <div className="space-y-2">
                {stats.topGenres.map(([genre, count]) => (
                  <StatBar
                    key={genre}
                    label={genre}
                    count={count}
                    total={stats.total}
                    color="bg-amber-400 dark:bg-amber-500"
                  />
                ))}
              </div>
            </StatCard>
          )}

          {/* Publication decades */}
          {stats.decades.length > 0 && (
            <StatCard title="Publication Decade">
              <BarChart
                data={stats.decades.map(([dec, count]) => ({ label: dec, value: count }))}
                color="bg-teal-400 dark:bg-teal-500"
              />
            </StatCard>
          )}

          {/* Top authors */}
          <StatCard title="Most Books by Author">
            <div className="space-y-2">
              {stats.topAuthors.map(([author, count]) => (
                <StatBar
                  key={author}
                  label={author}
                  count={count}
                  total={stats.total}
                  color="bg-purple-400 dark:bg-purple-500"
                />
              ))}
            </div>
          </StatCard>

          {/* Data enrichment */}
          <StatCard title="Data Enrichment" className="md:col-span-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
              <BigStat
                value={stats.withWorkId}
                label="Open Library Linked"
                sub={`${stats.total > 0 ? ((stats.withWorkId / stats.total) * 100).toFixed(0) : 0}%`}
              />
              <BigStat
                value={stats.withIsbn}
                label="Have ISBN"
                sub={`${stats.total > 0 ? ((stats.withIsbn / stats.total) * 100).toFixed(0) : 0}%`}
              />
              <BigStat
                value={stats.withSubjects}
                label="Have Genres"
                sub={`${stats.total > 0 ? ((stats.withSubjects / stats.total) * 100).toFixed(0) : 0}%`}
              />
              <BigStat
                value={stats.withYear}
                label="Have Publish Year"
                sub={`${stats.total > 0 ? ((stats.withYear / stats.total) * 100).toFixed(0) : 0}%`}
              />
              <BigStat value={stats.manualCount} label="Manually Added" />
              <BigStat
                value={stats.total - stats.withWorkId}
                label="Not Linked"
                sub="no Open Library match"
              />
            </div>
            <div className="space-y-2">
              <StatBar
                label="OL Linked"
                count={stats.withWorkId}
                total={stats.total}
                color="bg-emerald-400"
              />
              <StatBar
                label="Has ISBN"
                count={stats.withIsbn}
                total={stats.total}
                color="bg-blue-400"
              />
              <StatBar
                label="Has Genres"
                count={stats.withSubjects}
                total={stats.total}
                color="bg-amber-400"
              />
              <StatBar
                label="Has Year"
                count={stats.withYear}
                total={stats.total}
                color="bg-teal-400"
              />
            </div>
          </StatCard>

          {/* Library stats */}
          <StatCard title="Library Holdings" className="md:col-span-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <BigStat value={stats.totalCopies} label="Total Copies" sub="across all libraries" />
              <BigStat value={stats.totalHolds} label="Total Holds" sub="queue depth" />
              <BigStat value={stats.ebookCount} label="Ebook Listings" />
              <BigStat value={stats.audiobookCount} label="Audiobook Listings" />
            </div>
          </StatCard>
        </div>
      </div>
    </main>
  );
}
