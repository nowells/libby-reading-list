import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home/route.tsx"),
  route("setup", "routes/setup/route.tsx"),
  route("books", "routes/books/route.tsx"),
  route("authors", "routes/authors/route.tsx"),
  route("stats", "routes/stats/route.tsx"),
] satisfies RouteConfig;
