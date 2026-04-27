import type { MockAuthor, MockBook, MockLibrary } from "./types";

/**
 * Canonical fixture data shared by all e2e tests. Tests that need
 * additional records pass extras to `installMocks` rather than mutating
 * this module so suites stay isolated.
 */

export const fixtureLibraries: MockLibrary[] = [
  {
    key: "lapl",
    preferredKey: "lapl",
    name: "Los Angeles Public Library",
    type: "library",
    logoUrl: "https://example.test/lapl-logo.png",
  },
  {
    key: "nypl",
    preferredKey: "nypl",
    name: "New York Public Library",
    type: "library",
  },
];

export const fixtureBooks: MockBook[] = [
  {
    id: "media-children-of-time",
    title: "Children of Time",
    author: "Adrian Tchaikovsky",
    isbn13: "9780316452502",
    workId: "OL17823492W",
    olAuthorKey: "OL7313085A",
    coverHref: "https://example.test/covers/children-of-time.jpg",
    formatType: "ebook",
    ownedCopies: 5,
    availableCopies: 2,
    holdsCount: 0,
    isAvailable: true,
    publisher: "Pan Macmillan",
    publishDate: "2015-06-04",
    subjects: ["Science Fiction", "Space Opera"],
    firstPublishYear: 2015,
  },
  {
    id: "media-dune",
    title: "Dune",
    author: "Frank Herbert",
    isbn13: "9780441172719",
    workId: "OL45883W",
    olAuthorKey: "OL21594A",
    coverHref: "https://example.test/covers/dune.jpg",
    formatType: "ebook",
    ownedCopies: 6,
    availableCopies: 0,
    holdsCount: 8,
    isAvailable: false,
    estimatedWaitDays: 14,
    publisher: "Ace Books",
    publishDate: "1965-08-01",
    subjects: ["Science Fiction"],
    firstPublishYear: 1965,
  },
  {
    id: "media-hail-mary",
    title: "Project Hail Mary",
    author: "Andy Weir",
    isbn13: "9780593135204",
    workId: "OL20893640W",
    olAuthorKey: "OL7522928A",
    coverHref: "https://example.test/covers/hail-mary.jpg",
    formatType: "audiobook",
    ownedCopies: 3,
    availableCopies: 0,
    holdsCount: 22,
    isAvailable: false,
    estimatedWaitDays: 56,
    publisher: "Ballantine",
    publishDate: "2021-05-04",
    subjects: ["Science Fiction"],
    firstPublishYear: 2021,
  },
  {
    id: "media-children-of-ruin",
    title: "Children of Ruin",
    author: "Adrian Tchaikovsky",
    isbn13: "9780316452526",
    workId: "OL27911570W",
    olAuthorKey: "OL7313085A",
    coverHref: "https://example.test/covers/children-of-ruin.jpg",
    formatType: "ebook",
    ownedCopies: 2,
    availableCopies: 1,
    holdsCount: 1,
    isAvailable: true,
    publisher: "Pan Macmillan",
    publishDate: "2019-05-14",
    firstPublishYear: 2019,
  },
];

export const fixtureAuthors: MockAuthor[] = [
  {
    key: "OL7313085A",
    name: "Adrian Tchaikovsky",
    workCount: 30,
    topWork: "Children of Time",
    works: [
      { title: "Children of Time", firstPublishYear: 2015, workId: "OL17823492W" },
      { title: "Children of Ruin", firstPublishYear: 2019, workId: "OL27911570W" },
      { title: "Shards of Earth", firstPublishYear: 2021, workId: "OL27911580W" },
    ],
  },
  {
    key: "OL21594A",
    name: "Frank Herbert",
    workCount: 50,
    topWork: "Dune",
    works: [{ title: "Dune", firstPublishYear: 1965, workId: "OL45883W" }],
  },
  {
    key: "OL7522928A",
    name: "Andy Weir",
    workCount: 4,
    topWork: "The Martian",
    works: [
      { title: "Project Hail Mary", firstPublishYear: 2021, workId: "OL20893640W" },
      { title: "The Martian", firstPublishYear: 2011, workId: "OL16903120W" },
    ],
  },
];

/** Cover image as a 1x1 transparent PNG, base64-encoded. */
export const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

export const TEST_PDS_ORIGIN = "https://test-pds.shelfcheck.invalid";
