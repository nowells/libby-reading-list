import type { Route } from "./+types/api.availability";
import { getSession } from "~/lib/session.server";
import { findBookInLibrary } from "~/lib/libby.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  const libraryKey = session.get("libraryKey") as string;

  if (!libraryKey) {
    return Response.json({ error: "No library configured" }, { status: 400 });
  }

  const url = new URL(request.url);
  const title = url.searchParams.get("title");
  const author = url.searchParams.get("author") ?? "";

  if (!title) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  try {
    const result = await findBookInLibrary(libraryKey, title, author);
    return Response.json(result);
  } catch {
    return Response.json(
      { bookTitle: title, bookAuthor: author, results: [] },
    );
  }
}
