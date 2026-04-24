import type { Book, LibraryConfig, AuthorEntry } from "~/lib/storage";
import type { BookAvailability, BookAvailabilityResult } from "~/lib/libby";

// --- Library configs ---

export const mockLibraries: LibraryConfig[] = [
  {
    key: "lapl",
    preferredKey: "lapl",
    name: "Los Angeles Public Library",
    logoUrl: "https://example.com/lapl-logo.png",
  },
  {
    key: "nypl",
    preferredKey: "nypl",
    name: "New York Public Library",
  },
];

// --- Books ---

export const mockBooks: Book[] = [
  {
    id: "gr-1",
    title: "Children of Time",
    author: "Adrian Tchaikovsky",
    isbn13: "9780316452502",
    source: "goodreads",
    workId: "OL17823492W",
    canonicalTitle: "Children of Time",
    canonicalAuthor: "Adrian Tchaikovsky",
  },
  {
    id: "gr-2",
    title: "Dune",
    author: "Frank Herbert",
    isbn13: "9780441172719",
    source: "goodreads",
    workId: "OL45883W",
  },
  {
    id: "hc-1",
    title: "Project Hail Mary",
    author: "Andy Weir",
    isbn13: "9780593135204",
    source: "hardcover",
    workId: "OL20893640W",
    imageUrl: "https://example.com/hail-mary.jpg",
  },
];

// --- Authors ---

export const mockAuthors: AuthorEntry[] = [
  { id: "author-1", name: "Adrian Tchaikovsky", olKey: "OL7313085A" },
  { id: "author-2", name: "Frank Herbert" },
];

// --- Libby availability results ---

function makeAvailResult(overrides: Partial<BookAvailabilityResult> = {}): BookAvailabilityResult {
  return {
    mediaItem: {
      id: "media-1",
      title: "Children of Time",
      sortTitle: "children of time",
      type: { id: "ebook", name: "eBook" },
      formats: [{ id: "ebook-overdrive", name: "OverDrive Read" }],
      creators: [{ name: "Adrian Tchaikovsky", role: "Author" }],
      covers: { cover150Wide: { href: "https://example.com/cover.jpg" } },
      publisher: { id: "pub-1", name: "Pan Macmillan" },
      publishDate: "2015-06-04",
      isAvailable: true,
      ownedCopies: 5,
      availableCopies: 2,
      holdsCount: 0,
    },
    availability: {
      id: "media-1",
      copiesOwned: 5,
      copiesAvailable: 2,
      numberOfHolds: 0,
      isAvailable: true,
    },
    matchScore: 1,
    formatType: "ebook",
    libraryKey: "lapl",
    ...overrides,
  };
}

export const availableResult = makeAvailResult();

export const waitlistResult = makeAvailResult({
  mediaItem: {
    ...makeAvailResult().mediaItem,
    id: "media-2",
    isAvailable: false,
    availableCopies: 0,
    holdsCount: 15,
    estimatedWaitDays: 42,
  },
  availability: {
    id: "media-2",
    copiesOwned: 3,
    copiesAvailable: 0,
    numberOfHolds: 15,
    isAvailable: false,
    estimatedWaitDays: 42,
  },
  formatType: "audiobook",
});

export const soonResult = makeAvailResult({
  mediaItem: {
    ...makeAvailResult().mediaItem,
    id: "media-3",
    isAvailable: false,
    availableCopies: 0,
    holdsCount: 2,
    estimatedWaitDays: 7,
  },
  availability: {
    id: "media-3",
    copiesOwned: 3,
    copiesAvailable: 0,
    numberOfHolds: 2,
    isAvailable: false,
    estimatedWaitDays: 7,
  },
});

export const mockAvailability: BookAvailability = {
  bookTitle: "Children of Time",
  bookAuthor: "Adrian Tchaikovsky",
  coverUrl: "https://example.com/cover.jpg",
  results: [availableResult, waitlistResult],
};

// --- OpenLibrary responses ---

export const olEditionResponse = {
  title: "Children of Time",
  works: [{ key: "/works/OL17823492W" }],
  isbn_13: ["9780316452502"],
};

export const olSearchResponse = {
  docs: [
    {
      key: "/works/OL17823492W",
      title: "Children of Time",
      author_name: ["Adrian Tchaikovsky"],
      isbn: ["9780316452502"],
    },
  ],
};

export const olWorkMetadataResponse = {
  subjects: ["Science Fiction", "Space Opera", "Evolution"],
  first_publish_date: "2015",
};

export const olWorkEditionsResponse = {
  entries: [
    { isbn_13: ["9780316452502"], isbn_10: [] },
    { isbn_13: ["9781509836246"], isbn_10: ["1509836241"] },
  ],
};

// --- Libby Thunder API responses ---

export const thunderSearchResponse = {
  items: [
    {
      id: "media-1",
      title: "Children of Time",
      sortTitle: "children of time",
      type: { id: "ebook", name: "eBook" },
      formats: [{ id: "ebook-overdrive", name: "OverDrive Read" }],
      creators: [{ name: "Adrian Tchaikovsky", role: "Author" }],
      covers: { cover150Wide: { href: "https://example.com/cover.jpg" } },
      publisher: { id: "pub-1", name: "Pan Macmillan" },
      publishDate: "2015-06-04",
      isAvailable: true,
      ownedCopies: 5,
      availableCopies: 2,
      holdsCount: 0,
    },
  ],
};

export const thunderLibraryResponse = {
  preferredKey: "lapl",
  name: "Los Angeles Public Library",
};

export const libbyLocateResponse = {
  branches: [
    {
      systems: [
        {
          id: 1,
          name: "Los Angeles Public Library",
          fulfillmentId: "lapl",
          type: "library",
          isConsortium: false,
          styling: { logos: [{ sourceUrl: "https://example.com/lapl-logo.png" }] },
        },
      ],
    },
  ],
};
