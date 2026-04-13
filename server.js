import { createRequestHandler } from "@react-router/express";
import express from "express";
import path from "node:path";

const app = express();
const port = process.env.PORT || 3000;
const base = "/hardcoverlibby";

// Static assets — Web Station strips /hardcoverlibby, so requests arrive as /assets/...
app.use(
  "/assets",
  express.static(path.join(process.cwd(), "build/client/assets"), {
    immutable: true,
    maxAge: "1y",
  })
);
app.use(
  express.static(path.join(process.cwd(), "build/client"), {
    maxAge: "1h",
    redirect: false,
  })
);

// Re-add the stripped prefix so React Router's basename matching works
const handler = createRequestHandler({
  build: () => import("./build/server/index.js"),
});

app.all("*", (req, res, next) => {
  console.log(`[server] ${req.method} ${req.originalUrl}`);
  req.originalUrl = `${base}${req.originalUrl}`;
  req.url = `${base}${req.url}`;
  handler(req, res, next);
});

app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port} (build: ${new Date().toISOString()})`);
});
