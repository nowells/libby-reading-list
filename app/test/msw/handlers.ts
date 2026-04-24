import { http, HttpResponse } from "msw";
import {
  thunderSearchResponse,
  thunderLibraryResponse,
  libbyLocateResponse,
  olEditionResponse,
  olSearchResponse,
  olWorkMetadataResponse,
  olWorkEditionsResponse,
} from "./data";
import coverChildrenOfTime from "../fixtures/cover-children-of-time.png";
import coverDune from "../fixtures/cover-dune.png";

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

  http.get("https://openlibrary.org/search.json", () => {
    return HttpResponse.json(olSearchResponse);
  }),

  http.get("https://openlibrary.org/works/:workId.json", () => {
    return HttpResponse.json(olWorkMetadataResponse);
  }),

  http.get("https://openlibrary.org/works/:workId/editions.json", () => {
    return HttpResponse.json(olWorkEditionsResponse);
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
    return new HttpResponse(null, { status: 404 });
  }),
];
