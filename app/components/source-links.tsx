import type { Book } from "~/lib/storage";

const EXTERNAL_LINK_CLASS =
  "inline-flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors";

const LABEL_CLASS = "hidden sm:inline";

function PrimarySourceLink({ book }: { book: Book }) {
  if (book.source === "storygraph") {
    return (
      <a
        href={
          book.sourceUrl ??
          `https://app.thestorygraph.com/browse?search_term=${encodeURIComponent(`${book.title} ${book.author}`)}`
        }
        target="_blank"
        rel="noopener noreferrer"
        className={EXTERNAL_LINK_CLASS}
        title="View on The StoryGraph"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 3h18v18H3V3zm2 2v14h14V5H5zm2 10h2v2H7v-2zm4-4h2v6h-2v-6zm4-4h2v10h-2V7z" />
        </svg>
        <span className={LABEL_CLASS}>The StoryGraph</span>
      </a>
    );
  }

  if (book.source === "lyndi") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z" />
        </svg>
        <span className={LABEL_CLASS}>Lyndi CSV</span>
      </span>
    );
  }

  if (book.source === "bookhive") {
    return (
      <a
        href={
          book.sourceUrl ??
          `https://bookhive.buzz/search?q=${encodeURIComponent(`${book.title} ${book.author}`)}`
        }
        target="_blank"
        rel="noopener noreferrer"
        className={EXTERNAL_LINK_CLASS}
        title="View on Bookhive"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l3 6 6 .9-4.5 4.2 1 6.4L12 16.6 6.5 19.5l1-6.4L3 8.9 9 8l3-6z" />
        </svg>
        <span className={LABEL_CLASS}>Bookhive</span>
      </a>
    );
  }

  return (
    <>
      {(book.source === "goodreads" || book.source === "unknown") && (
        <a
          href={
            book.sourceUrl ??
            `https://www.goodreads.com/search?q=${encodeURIComponent(`${book.title} ${book.author}`)}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className={EXTERNAL_LINK_CLASS}
          title="View on Goodreads"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.525 15.977V.49h-2.059v2.906h-.064c-.211-.455-.481-.891-.842-1.307-.36-.412-.767-.761-1.243-1.043C14.837.763 14.275.63 13.634.63c-1.17 0-2.137.369-2.91 1.107-.773.738-1.353 1.708-1.737 2.91-.385 1.198-.58 2.498-.58 3.905 0 1.387.2 2.682.586 3.876.39 1.199.966 2.16 1.731 2.904.77.738 1.737 1.109 2.91 1.109.596 0 1.148-.127 1.66-.381.51-.254.942-.58 1.296-.984.352-.398.616-.818.79-1.26h.064v2.197c0 1.553-.32 2.742-.96 3.56-.641.822-1.566 1.23-2.773 1.23-.682 0-1.27-.14-1.77-.424a3.013 3.013 0 01-1.178-1.107 3.368 3.368 0 01-.497-1.473h-2.165c.08.941.365 1.775.854 2.504.49.729 1.133 1.299 1.93 1.713.8.418 1.717.625 2.747.625 1.322 0 2.398-.287 3.223-.863.828-.576 1.436-1.373 1.826-2.391.39-1.018.588-2.191.588-3.525zM13.737 14.41c-.86 0-1.563-.26-2.107-.781-.547-.52-.95-1.209-1.213-2.07-.264-.858-.394-1.79-.394-2.791 0-.988.13-1.916.394-2.783.268-.87.671-1.57 1.213-2.1.544-.533 1.247-.798 2.107-.798.88 0 1.59.27 2.133.81.547.537.95 1.24 1.213 2.107.264.862.396 1.79.396 2.783 0 .983-.13 1.9-.39 2.756-.26.861-.664 1.555-1.213 2.084-.548.525-1.26.783-2.14.783z" />
          </svg>
          <span className={LABEL_CLASS}>Goodreads</span>
        </a>
      )}
      {(book.source === "hardcover" || book.source === "unknown") && (
        <a
          href={
            book.sourceUrl ?? `https://hardcover.app/search?q=${encodeURIComponent(book.title)}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className={EXTERNAL_LINK_CLASS}
          title="View on Hardcover"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H6zm1 2h10v7l-3-2-3 2V4H7z" />
          </svg>
          <span className={LABEL_CLASS}>Hardcover</span>
        </a>
      )}
    </>
  );
}

export function SourceLinks({ book }: { book: Book }) {
  if (book.manual) return null;
  return (
    <>
      <PrimarySourceLink book={book} />
      {book.workId && (
        <a
          href={`https://openlibrary.org/works/${book.workId}`}
          target="_blank"
          rel="noopener noreferrer"
          className={EXTERNAL_LINK_CLASS}
          title="View on Open Library"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4V4zm16 0h-6a3 3 0 00-3 3v13a2 2 0 012-2h7V4z" />
          </svg>
          <span className={LABEL_CLASS}>Open Library</span>
        </a>
      )}
    </>
  );
}
