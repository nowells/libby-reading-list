import type { LibbyMediaItem } from "~/lib/libby";

/**
 * The minimum subset of fields per item that the series-enrichment
 * pipeline reads. Captured verbatim from a real Libby/OverDrive
 * `query=Chief+Inspector+Armand+Gamache` response (library `gmlc`,
 * page 1) so the test can exercise the dedup ladder against real data
 * without lugging the entire 47-item payload into the bundle.
 *
 * Notable shape:
 *   - Every book in this series shows up as TWO top-level items —
 *     one ebook, one audiobook — under different OverDrive ids and
 *     different reserveIds. They share `detailedSeries.readingOrder`
 *     and `sortTitle`, which is what dedup keys off.
 *   - The result set paginates at 24/page. The real query reports
 *     `totalItems: 47` with `last.page: 2`, which is why our
 *     pagination tests live alongside this fixture.
 */
function libbyItem(overrides: Partial<LibbyMediaItem>): LibbyMediaItem {
  return {
    id: "media",
    title: "Title",
    sortTitle: "title",
    type: { id: "ebook", name: "eBook" },
    formats: [],
    creators: [{ name: "Louise Penny", role: "Author" }],
    ...overrides,
  };
}

export const gamacheLibbyPage1Items: LibbyMediaItem[] = [
  // The Black Wolf #20 — ebook + audiobook
  libbyItem({
    id: "11392848",
    title: "The Black Wolf",
    sortTitle: "Black Wolf",
    type: { id: "ebook", name: "eBook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "20" },
  }),
  libbyItem({
    id: "11385641",
    title: "The Black Wolf",
    sortTitle: "Black Wolf",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "20" },
  }),
  // Still Life #1 — audiobook + ebook (the one we kept seeing duplicated)
  libbyItem({
    id: "1735678",
    title: "Still Life",
    sortTitle: "Still Life",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "1" },
  }),
  libbyItem({
    id: "513688",
    title: "Still Life",
    sortTitle: "Still Life",
    type: { id: "ebook", name: "eBook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "1" },
  }),
  // The Grey Wolf #19 — ebook + audiobook
  libbyItem({
    id: "10346319",
    title: "The Grey Wolf",
    sortTitle: "Grey Wolf",
    type: { id: "ebook", name: "eBook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "19" },
  }),
  libbyItem({
    id: "10379411",
    title: "The Grey Wolf",
    sortTitle: "Grey Wolf",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "19" },
  }),
  // A Fatal Grace #2 — audiobook + ebook
  libbyItem({
    id: "1735681",
    title: "A Fatal Grace",
    sortTitle: "Fatal Grace",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "2" },
  }),
  libbyItem({
    id: "510514",
    title: "A Fatal Grace",
    sortTitle: "Fatal Grace",
    type: { id: "ebook", name: "eBook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "2" },
  }),
  // Beautiful Mystery #8 — only audiobook on page 1
  libbyItem({
    id: "985444",
    title: "The Beautiful Mystery",
    sortTitle: "Beautiful Mystery",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "8" },
  }),
  // World of Curiosities #18 — only audiobook on page 1
  libbyItem({
    id: "8970072",
    title: "A World of Curiosities",
    sortTitle: "World of Curiosities",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "18" },
  }),
  // The Cruelest Month #3 — audiobook + ebook
  libbyItem({
    id: "2377531",
    title: "The Cruelest Month",
    sortTitle: "Cruelest Month",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "3" },
  }),
  libbyItem({
    id: "514060",
    title: "The Cruelest Month",
    sortTitle: "Cruelest Month",
    type: { id: "ebook", name: "eBook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "3" },
  }),
  // How the Light Gets In #9
  libbyItem({
    id: "1346918",
    title: "How the Light Gets In",
    sortTitle: "How the Light Gets In",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "9" },
  }),
  // Bury Your Dead #6
  libbyItem({
    id: "451816",
    title: "Bury Your Dead",
    sortTitle: "Bury Your Dead",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "6" },
  }),
  // A Trick of the Light #7
  libbyItem({
    id: "628804",
    title: "A Trick of the Light",
    sortTitle: "Trick of the Light",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "7" },
  }),
  // The Long Way Home #10
  libbyItem({
    id: "1859929",
    title: "The Long Way Home",
    sortTitle: "Long Way Home",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "10" },
  }),
  // All the Devils Are Here #16
  libbyItem({
    id: "5233416",
    title: "All the Devils Are Here",
    sortTitle: "All the Devils Are Here",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "16" },
  }),
  // Madness of Crowds #17
  libbyItem({
    id: "6011315",
    title: "The Madness of Crowds",
    sortTitle: "Madness of Crowds",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "17" },
  }),
  // A Great Reckoning #12
  libbyItem({
    id: "2781799",
    title: "A Great Reckoning",
    sortTitle: "Great Reckoning",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "12" },
  }),
  // Kingdom of the Blind #14
  libbyItem({
    id: "3788122",
    title: "Kingdom of the Blind",
    sortTitle: "Kingdom of the Blind",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "14" },
  }),
  // The Hangman #6.5 (a novella, ebook only)
  libbyItem({
    id: "686726",
    title: "The Hangman",
    sortTitle: "Hangman",
    type: { id: "ebook", name: "eBook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "6.5" },
  }),
  // A Better Man #15
  libbyItem({
    id: "4603951",
    title: "A Better Man",
    sortTitle: "Better Man",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "15" },
  }),
  // The Nature of the Beast #11
  libbyItem({
    id: "2286100",
    title: "The Nature of the Beast",
    sortTitle: "Nature of the Beast",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "11" },
  }),
  // Glass Houses #13
  libbyItem({
    id: "3284451",
    title: "Glass Houses",
    sortTitle: "Glass Houses",
    type: { id: "audiobook", name: "Audiobook" },
    detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "13" },
  }),
];

/**
 * The number of *unique* books represented on page 1 — used as the
 * golden expected count when running the extractor against the
 * fixture. Several titles arrive twice (ebook + audiobook); the
 * extractor must collapse those into one candidate each.
 */
export const gamacheUniqueBookCount = 19;
