import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home/route.tsx"),
  route("setup", "routes/setup/route.tsx"),
  route("books", "routes/books/route.tsx"),
  route("shelf", "routes/shelf/route.tsx"),
  route("authors", "routes/authors/route.tsx"),
  route("author/:authorKey", "routes/author/route.tsx"),
  route("book/:workId", "routes/book/route.tsx"),
  route("friends", "routes/friends/route.tsx"),
  route("stats", "routes/stats/route.tsx"),
] satisfies RouteConfig;
