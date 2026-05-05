import { redirect } from "react-router";

export const handle = { navActive: "books", pageTitle: "Your books" };

/**
 * /shelf was the "show every book regardless of status" view. It has been
 * folded into /books, which now defaults to the want-to-read filter but
 * exposes the same status pills the old /shelf had. Preserve the URL with
 * a redirect so existing bookmarks (and the e2e ShelfPage helpers) keep
 * working — passing `?status=all` mirrors the old all-statuses default.
 */
export function clientLoader() {
  throw redirect("/books?status=all");
}

export default function ShelfRedirect() {
  return null;
}
