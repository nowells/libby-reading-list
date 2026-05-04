import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OAUTH_SCOPE =
  "atproto repo:org.shelfcheck.shelf.entry repo:org.shelfcheck.author.follow repo:org.shelfcheck.book.dismissed";

/**
 * Generates `client-metadata.json` in the build output with the correct
 * origin so the AT Proto OAuth `client_id` matches the serving domain.
 *
 * Set `VITE_SITE_URL` to the deployment origin (e.g.
 * `https://libby-reading-list.nowell.workers.dev`). Defaults to
 * `https://www.shelfcheck.org` for production.
 */
function atprotoClientMetadata(): Plugin {
  return {
    name: "atproto-client-metadata",
    writeBundle(options) {
      const origin = (process.env.VITE_SITE_URL ?? "https://www.shelfcheck.org").replace(/\/$/, "");
      const metadata = {
        client_id: `${origin}/client-metadata.json`,
        client_name: "ShelfCheck",
        client_uri: origin,
        logo_uri: `${origin}/apple-touch-icon.png`,
        redirect_uris: [`${origin}/setup`],
        scope: OAUTH_SCOPE,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "web",
        dpop_bound_access_tokens: true,
      };
      const outDir = options.dir ?? resolve("build/client");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(resolve(outDir, "client-metadata.json"), JSON.stringify(metadata, null, 2));
    },
  };
}

export default defineConfig({
  base: process.env.BASENAME ?? "/",
  plugins: [tailwindcss(), reactRouter(), atprotoClientMetadata()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    host: "127.0.0.1",
  },
  ssr: {
    noExternal: ["posthog-js", "@posthog/react"],
  },
});
