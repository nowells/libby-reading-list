import { Link, redirect } from "react-router";
import { useState, useEffect, useMemo } from "react";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { initSession } from "~/lib/atproto";
import type { ShelfEntryRecord } from "~/lib/atproto/lexicon";
import { statusTokenName } from "~/lib/atproto/lexicon";
import {
  getBooks,
  getAuthors,
  getLibraries,
  addBook,
  addAuthor,
  type AuthorEntry,
} from "~/lib/storage";
import { useFriends } from "./hooks/use-friends";
import { FriendCard } from "./components/friend-card";

export const handle = { navActive: "friends", pageTitle: "Friends" };

export function meta() {
  return [{ title: "Friends | ShelfCheck" }];
}

export function clientLoader() {
  const libraries = getLibraries();
  if (libraries.length === 0) {
    throw redirect("/setup");
  }
  return { libraries };
}

export default function Friends() {
  const [session, setSession] = useState<OAuthSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [books, setBooksState] = useState(() => getBooks());
  const [authors, setAuthorsState] = useState<AuthorEntry[]>(() => getAuthors());

  useEffect(() => {
    initSession().then((result) => {
      if (result) {
        setSession(result.session);
      }
      setSessionChecked(true);
    });
  }, []);

  const { friends, status, refreshing, progress, error, refresh, refreshFriend, refreshingDids } =
    useFriends(session);

  // Track which books/authors the user already has
  const addedBookIds = useMemo(() => {
    const ids = new Set<string>();
    for (const book of books) {
      if (book.workId) ids.add(book.workId);
      ids.add(`${book.title}\0${book.author}`);
    }
    return ids;
  }, [books]);

  const addedAuthorKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const a of authors) {
      if (a.olKey) keys.add(a.olKey);
      keys.add(a.name.toLowerCase());
    }
    return keys;
  }, [authors]);

  const handleAddBook = (entry: ShelfEntryRecord) => {
    const authorName = entry.authors?.[0]?.name ?? "Unknown";
    addBook({
      title: entry.title,
      author: authorName,
      source: "unknown",
      workId: entry.ids.olWorkId,
      isbn13: entry.ids.isbn13,
      imageUrl: entry.coverUrl,
      subjects: entry.subjects,
      pageCount: entry.pageCount,
      firstPublishYear: entry.firstPublishYear,
      status: statusTokenName(entry.status) === "wantToRead" ? undefined : "wantToRead",
    });
    setBooksState(getBooks());
  };

  const handleAddAuthor = (name: string, olKey?: string) => {
    addAuthor({ name, olKey });
    setAuthorsState(getAuthors());
  };

  // Filter for search
  const [searchQuery, setSearchQuery] = useState("");

  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return friends;
    const q = searchQuery.toLowerCase();
    return friends.filter((f) => {
      if (f.profile.displayName?.toLowerCase().includes(q)) return true;
      if (f.profile.handle.toLowerCase().includes(q)) return true;
      if (f.entries.some((e) => e.title.toLowerCase().includes(q))) return true;
      if (f.authors.some((a) => a.name.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [friends, searchQuery]);

  return (
    <main className="min-h-screen py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {friends.length} {friends.length === 1 ? "friend" : "friends"} on ShelfCheck
            </span>
            {status === "done" && !refreshing && (
              <button
                type="button"
                onClick={refresh}
                title="Refresh friends list"
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Refresh
              </button>
            )}
          </div>
        </div>

        {/* Top-level progress bar (shown while refreshing if we have friends to display) */}
        {refreshing && friends.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded-lg border border-purple-100 dark:border-purple-900/40 bg-purple-50/60 dark:bg-purple-900/10 px-3 py-2"
          >
            <div className="flex items-center gap-2 text-xs text-purple-700 dark:text-purple-300">
              <svg
                className="w-3.5 h-3.5 animate-spin flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span className="flex-1 truncate">
                {progress?.phase === "discovering"
                  ? `Discovering new friends${progress ? ` · ${progress.checked} of ${progress.total} follows` : ""}`
                  : progress?.phase === "refreshing"
                    ? `Refreshing reading lists · ${progress.checked} of ${progress.total}`
                    : "Refreshing…"}
              </span>
            </div>
            {progress && progress.total > 0 && (
              <div className="mt-1.5 h-1 w-full bg-purple-100 dark:bg-purple-900/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 dark:bg-purple-400 transition-all duration-300"
                  style={{
                    width: `${Math.min(100, Math.round((progress.checked / progress.total) * 100))}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Not logged in state */}
        {sessionChecked && !session && (
          <div className="text-center py-12 px-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-blue-600 dark:text-blue-400"
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
            </div>
            <p className="text-gray-600 dark:text-gray-300 mb-2 font-medium">
              Sign in with Bluesky to see friends
            </p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-4 max-w-sm mx-auto">
              Connect your Bluesky account to discover which of your follows also use ShelfCheck and
              browse their bookshelves.
            </p>
            <Link
              to="/setup"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              Go to Settings
            </Link>
          </div>
        )}

        {/* Loading state */}
        {session && status === "loading" && (
          <div className="text-center py-12 px-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
            <svg
              className="w-8 h-8 animate-spin text-purple-500 mx-auto mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <p className="text-gray-600 dark:text-gray-300 mb-1">Discovering friends...</p>
            {progress && (
              <p className="text-sm text-gray-400 dark:text-gray-500">
                Checked {progress.checked} of {progress.total} follows
              </p>
            )}
          </div>
        )}

        {/* Error state */}
        {status === "error" && (
          <div className="text-center py-8 px-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm">
            <p className="text-red-500 dark:text-red-400 text-sm mb-2">{error}</p>
            <button
              onClick={refresh}
              className="text-sm text-purple-600 hover:text-purple-700 dark:text-purple-400"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty state - logged in but no friends found */}
        {session && status === "done" && friends.length === 0 && (
          <div className="text-center py-12 px-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
            <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-purple-600 dark:text-purple-400"
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
            </div>
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              None of your Bluesky follows use ShelfCheck yet.
            </p>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              When your follows sign up and add books, they&apos;ll appear here.
            </p>
          </div>
        )}

        {/* Search bar */}
        {status === "done" && friends.length > 0 && (
          <div className="relative mb-4">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name, handle, or book title..."
              className="w-full pl-10 pr-9 py-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-400 dark:focus:ring-purple-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* No search results */}
        {status === "done" && friends.length > 0 && filteredFriends.length === 0 && (
          <div className="text-center py-8 px-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              No friends matching &quot;{searchQuery.trim()}&quot;.
            </p>
            <button
              onClick={() => setSearchQuery("")}
              className="mt-2 text-sm text-purple-600 hover:text-purple-700"
            >
              Clear search
            </button>
          </div>
        )}

        {/* Friend cards */}
        <div className="space-y-3">
          {filteredFriends.map((friend) => (
            <FriendCard
              key={friend.profile.did}
              friend={friend}
              onAddBook={handleAddBook}
              onAddAuthor={handleAddAuthor}
              onRefresh={refreshFriend}
              isRefreshing={refreshingDids.has(friend.profile.did)}
              addedBookIds={addedBookIds}
              addedAuthorKeys={addedAuthorKeys}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
