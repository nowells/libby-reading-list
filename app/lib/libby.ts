const THUNDER_API_URL = "https://thunder.api.overdrive.com/v2";

export interface LibbyLibrary {
  id: number;
  name: string;
  fulfillmentId: string;
  preferredKey?: string;
  type?: string;
  isConsortium?: boolean;
  logoUrl?: string;
}

export interface LibbyMediaItem {
  id: string;
  title: string;
  sortTitle: string;
  subtitle?: string;
  type: { id: string; name: string };
  formats: Array<{ id: string; name: string }>;
  creators: Array<{ name: string; role: string }>;
  covers?: { cover150Wide?: { href: string } };
  isAvailable?: boolean;
  ownedCopies?: number;
  availableCopies?: number;
  holdsCount?: number;
  estimatedWaitDays?: number;
}

export interface AvailabilityInfo {
  id: string;
  copiesOwned: number;
  copiesAvailable: number;
  numberOfHolds: number;
  isAvailable: boolean;
  estimatedWaitDays?: number;
}

async function thunderFetch(path: string) {
  const url = `${THUNDER_API_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      "x-client-id": "dewey",
    },
  });
  if (!res.ok) {
    throw new Error(`Libby API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function getLibraryPreferredKey(
  fulfillmentId: string
): Promise<string> {
  const data = await thunderFetch(`/libraries/${fulfillmentId}`);
  return data.preferredKey ?? fulfillmentId;
}

export async function searchLibrary(
  libraryKey: string,
  query: string,
  format?: "ebook" | "audiobook"
): Promise<LibbyMediaItem[]> {
  const params = new URLSearchParams({ query });
  if (format === "ebook") {
    params.set("format", "ebook-kindle,ebook-overdrive,ebook-epub-adobe,ebook-epub-open,ebook-media-do");
  } else if (format === "audiobook") {
    params.set("format", "audiobook-overdrive,audiobook-mp3");
  }
  const data = await thunderFetch(
    `/libraries/${libraryKey}/media?${params.toString()}`
  );
  return data.items ?? [];
}

export async function getAvailability(
  libraryKey: string,
  titleId: string
): Promise<AvailabilityInfo> {
  const data = await thunderFetch(
    `/libraries/${libraryKey}/media/${titleId}/availability`
  );
  return {
    id: titleId,
    copiesOwned: data.ownedCopies ?? 0,
    copiesAvailable: data.availableCopies ?? 0,
    numberOfHolds: data.holdsCount ?? 0,
    isAvailable: data.isAvailable ?? (data.availableCopies ?? 0) > 0,
    estimatedWaitDays: data.estimatedWaitDays,
  };
}

export async function searchLibraryByName(
  query: string
): Promise<LibbyLibrary[]> {
  const url = `https://locate.libbyapp.com/autocomplete/${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Libby locate API error: ${res.status}`);
  }
  const data = await res.json();

  const seen = new Set<number>();
  const libraries: LibbyLibrary[] = [];

  for (const branch of data.branches ?? []) {
    for (const system of branch.systems ?? []) {
      if (seen.has(system.id)) continue;
      seen.add(system.id);
      libraries.push({
        id: system.id,
        name: system.name,
        fulfillmentId: system.fulfillmentId,
        type: system.type,
        isConsortium: system.isConsortium,
        logoUrl: system.styling?.logos?.[0]?.sourceUrl,
      });
    }
  }

  return libraries;
}

function similarityScore(a: string, b: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;

  const wordsA = na.split(" ");
  const wordsB = nb.split(" ");
  const intersection = wordsA.filter((w) => wordsB.includes(w));
  return (2 * intersection.length) / (wordsA.length + wordsB.length);
}

export interface BookAvailability {
  bookTitle: string;
  bookAuthor: string;
  results: Array<{
    mediaItem: LibbyMediaItem;
    availability: AvailabilityInfo;
    matchScore: number;
    formatType: string;
  }>;
}

export async function findBookInLibrary(
  libraryKey: string,
  title: string,
  author: string
): Promise<BookAvailability> {
  const result: BookAvailability = {
    bookTitle: title,
    bookAuthor: author,
    results: [],
  };

  const queries = [
    `${author} ${title}`,
    title.includes(":") ? `${author} ${title.split(":")[0].trim()}` : null,
    title,
  ].filter(Boolean) as string[];

  const seenIds = new Set<string>();

  for (const query of queries) {
    try {
      const items = await searchLibrary(libraryKey, query);
      for (const item of items.slice(0, 5)) {
        if (seenIds.has(item.id)) continue;

        const titleScore = similarityScore(title, item.title);
        const authorName =
          item.creators?.find((c) => c.role === "Author")?.name ?? "";
        const authorScore = author
          ? similarityScore(author, authorName)
          : 0.5;

        if (titleScore >= 0.4 && authorScore >= 0.3) {
          seenIds.add(item.id);
          try {
            const avail = await getAvailability(libraryKey, item.id);
            const formatType = item.type?.id ?? "unknown";
            result.results.push({
              mediaItem: item,
              availability: avail,
              matchScore: (titleScore + authorScore) / 2,
              formatType,
            });
          } catch {
            // Skip items where availability check fails
          }
        }
      }
    } catch {
      // Continue to next query
    }

    if (result.results.length > 0) break;
  }

  result.results.sort((a, b) => b.matchScore - a.matchScore);
  return result;
}
