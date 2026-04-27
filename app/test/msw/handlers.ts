import { http, HttpResponse } from "msw";
import {
  thunderSearchResponse,
  thunderLibraryResponse,
  libbyLocateResponse,
  olEditionResponse,
  olSearchResponse,
  olWorkMetadataResponse,
  olWorkEditionsResponse,
  olWorkDetailsResponse,
  olWorkRatingsResponse,
  olAuthorDetailsResponse,
  olAuthorWorksResponse,
  olSeriesSearchResponse,
} from "./data";
import coverChildrenOfTime from "../fixtures/cover-children-of-time.png";
import coverDune from "../fixtures/cover-dune.png";
import logoLapl from "../fixtures/logo-lapl.png";

const coverMap: Record<string, string> = {
  "9780316452502": coverChildrenOfTime,
  "9780441172719": coverDune,
};

export const handlers = [
  // --- Libby Thunder API ---
  http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
    return HttpResponse.json(thunderSearchResponse);
  }),

  http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media/:titleId", () => {
    return HttpResponse.json(thunderSearchResponse.items[0]);
  }),

  http.get(
    "https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media/:titleId/availability",
    () => {
      return HttpResponse.json({
        ownedCopies: 5,
        copiesAvailable: 2,
        holdsCount: 0,
        isAvailable: true,
      });
    },
  ),

  http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey", () => {
    return HttpResponse.json(thunderLibraryResponse);
  }),

  // --- Libby Locate API ---
  http.get("https://locate.libbyapp.com/autocomplete/:query", () => {
    return HttpResponse.json(libbyLocateResponse);
  }),

  // --- OpenLibrary ---
  http.get("https://openlibrary.org/isbn/:isbn.json", () => {
    return HttpResponse.json(olEditionResponse);
  }),

  http.get("https://openlibrary.org/search.json", ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    if (q.startsWith("series:")) {
      return HttpResponse.json(olSeriesSearchResponse);
    }
    return HttpResponse.json(olSearchResponse);
  }),

  // The book details page calls `/works/:id.json` for the rich detail view;
  // the legacy metadata-only test path overlaps and used the same endpoint.
  // Return the richer payload — `getWorkMetadata` only reads the subset of
  // fields it cares about so the test still validates that path.
  http.get("https://openlibrary.org/works/:workId.json", () => {
    return HttpResponse.json({ ...olWorkDetailsResponse, ...olWorkMetadataResponse });
  }),

  http.get("https://openlibrary.org/works/:workId/editions.json", () => {
    return HttpResponse.json(olWorkEditionsResponse);
  }),

  http.get("https://openlibrary.org/works/:workId/ratings.json", () => {
    return HttpResponse.json(olWorkRatingsResponse);
  }),

  http.get("https://openlibrary.org/authors/:authorKey.json", () => {
    return HttpResponse.json(olAuthorDetailsResponse);
  }),

  http.get("https://openlibrary.org/authors/:authorKey/works.json", () => {
    return HttpResponse.json(olAuthorWorksResponse);
  }),

  http.get("https://openlibrary.org/search/authors.json", () => {
    return HttpResponse.json({
      docs: [{ key: "OL7313085A", name: "Adrian Tchaikovsky", work_count: 50 }],
    });
  }),

  // --- Cover images ---
  http.get("https://covers.openlibrary.org/b/isbn/:isbn-M.jpg", ({ params }) => {
    const isbn = (params.isbn as string).replace(/-M\.jpg$/, "");
    const coverUrl = coverMap[isbn];
    if (coverUrl) {
      return HttpResponse.redirect(coverUrl, 302);
    }
    return new HttpResponse(null, { status: 404 });
  }),

  http.get("https://example.com/cover.jpg", () => {
    return HttpResponse.redirect(coverChildrenOfTime, 302);
  }),

  http.get("https://example.com/lapl-logo.png", () => {
    return HttpResponse.redirect(logoLapl, 302);
  }),
];
