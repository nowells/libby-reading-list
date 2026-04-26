import { useState } from "react";
import type { FriendShelf } from "~/lib/atproto/friends";
import type { ShelfEntryRecord } from "~/lib/atproto/lexicon";
import { statusTokenName } from "~/lib/atproto/lexicon";

interface FriendCardProps {
  friend: FriendShelf;
  onAddBook: (entry: ShelfEntryRecord) => void;
  onAddAuthor: (name: string, olKey?: string) => void;
  addedBookIds: Set<string>;
  addedAuthorKeys: Set<string>;
}

type TabFilter = "all" | "wantToRead" | "reading" | "finished";

function entryKey(entry: ShelfEntryRecord): string {
  return entry.ids.olWorkId ?? `${entry.title}\0${entry.authors?.[0]?.name ?? ""}`;
}

export function FriendCard({
  friend,
  onAddBook,
  onAddAuthor,
  addedBookIds,
  addedAuthorKeys,
}: FriendCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<TabFilter>("all");
  const [showAuthors, setShowAuthors] = useState(false);

  const { profile, entries, authors } = friend;

  const filteredEntries = entries.filter((e) => {
    if (tab === "all") return true;
    return statusTokenName(e.status) === tab;
  });

  const statusCounts = {
    wantToRead: entries.filter((e) => statusTokenName(e.status) === "wantToRead").length,
    reading: entries.filter((e) => statusTokenName(e.status) === "reading").length,
    finished: entries.filter((e) => statusTokenName(e.status) === "finished").length,
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
      >
        {profile.avatar ? (
          <img
            src={profile.avatar}
            alt=""
            className="w-10 h-10 rounded-full flex-shrink-0 object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full flex-shrink-0 bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
              {(profile.displayName ?? profile.handle)[0]?.toUpperCase()}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {profile.displayName ?? profile.handle}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">@{profile.handle}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {entries.length} {entries.length === 1 ? "book" : "books"}
            {authors.length > 0 && ` · ${authors.length} authors`}
          </span>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700">
          {/* Tabs */}
          <div className="flex items-center gap-1 px-4 pt-3 pb-2 overflow-x-auto">
            <TabButton active={tab === "all"} onClick={() => setTab("all")}>
              All ({entries.length})
            </TabButton>
            {statusCounts.wantToRead > 0 && (
              <TabButton active={tab === "wantToRead"} onClick={() => setTab("wantToRead")}>
                Want to Read ({statusCounts.wantToRead})
              </TabButton>
            )}
            {statusCounts.reading > 0 && (
              <TabButton active={tab === "reading"} onClick={() => setTab("reading")}>
                Reading ({statusCounts.reading})
              </TabButton>
            )}
            {statusCounts.finished > 0 && (
              <TabButton active={tab === "finished"} onClick={() => setTab("finished")}>
                Finished ({statusCounts.finished})
              </TabButton>
            )}
            {authors.length > 0 && (
              <TabButton active={showAuthors} onClick={() => setShowAuthors(!showAuthors)}>
                Authors ({authors.length})
              </TabButton>
            )}
          </div>

          {/* Authors section */}
          {showAuthors && (
            <div className="px-4 pb-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {authors.map((author) => {
                  const key = author.olAuthorKey ?? author.name.toLowerCase();
                  const alreadyAdded = addedAuthorKeys.has(key);
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-750"
                    >
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                        {author.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => onAddAuthor(author.name, author.olAuthorKey)}
                        disabled={alreadyAdded}
                        className={`flex-shrink-0 text-xs px-2 py-1 rounded ${
                          alreadyAdded
                            ? "text-gray-400 dark:text-gray-500 cursor-default"
                            : "text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                        }`}
                      >
                        {alreadyAdded ? "Added" : "+ Follow"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Books list */}
          {!showAuthors && (
            <div className="px-4 pb-3 space-y-2 max-h-96 overflow-y-auto">
              {filteredEntries.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                  No books in this category.
                </p>
              )}
              {filteredEntries.map((entry) => {
                const key = entryKey(entry);
                const alreadyAdded = addedBookIds.has(key);
                const status = statusTokenName(entry.status);
                return (
                  <div
                    key={key}
                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-750"
                  >
                    {entry.coverUrl ? (
                      <img
                        src={entry.coverUrl}
                        alt=""
                        className="w-10 h-14 object-cover rounded flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-14 bg-gray-200 dark:bg-gray-700 rounded flex-shrink-0 flex items-center justify-center">
                        <svg
                          className="w-5 h-5 text-gray-400"
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
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {entry.title}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {entry.authors?.map((a) => a.name).join(", ")}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <StatusBadge status={status} />
                        {entry.rating != null && entry.rating > 0 && (
                          <span className="text-xs text-amber-500">
                            {"★".repeat(Math.round(entry.rating / 20))}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAddBook(entry)}
                      disabled={alreadyAdded}
                      className={`flex-shrink-0 text-xs px-2 py-1 rounded mt-1 ${
                        alreadyAdded
                          ? "text-gray-400 dark:text-gray-500 cursor-default"
                          : "text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                      }`}
                    >
                      {alreadyAdded ? "Added" : "+ Add"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
        active
          ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium"
          : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: string | undefined }) {
  const config: Record<string, { label: string; className: string }> = {
    wantToRead: {
      label: "Want to Read",
      className: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    },
    reading: {
      label: "Reading",
      className: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
    },
    finished: {
      label: "Finished",
      className: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
    },
    abandoned: {
      label: "Abandoned",
      className: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
    },
  };
  const c = config[status ?? "wantToRead"] ?? config.wantToRead;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.className}`}>{c.label}</span>;
}
