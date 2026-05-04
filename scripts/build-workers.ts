/**
 * Build for Cloudflare Workers with the correct VITE_SITE_URL.
 *
 * Derives the site URL from the worker name + branch so the AT Proto OAuth
 * client-metadata.json is generated with the correct origin.
 *
 *   Production (main):   https://libby-reading-list.nowell.workers.dev
 *   Non-production:      https://<branch>-libby-reading-list.nowell.workers.dev
 *
 * Usage:
 *   node --experimental-strip-types scripts/build-workers.ts
 *   node --experimental-strip-types scripts/build-workers.ts --name my-preview-libby-reading-list
 *
 * Environment variables:
 *   CF_PAGES_BRANCH       – branch being built (Cloudflare Pages CI)
 *   CF_BRANCH             – branch being built (Cloudflare Workers CI)
 *   CF_PRODUCTION_BRANCH  – production branch name (default: main)
 *   CF_WORKERS_SUBDOMAIN  – account workers.dev subdomain (default: nowell.workers.dev)
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function readWorkerName(): string {
  const raw = readFileSync(resolve(root, "wrangler.jsonc"), "utf-8");
  const json = raw.replace(/\/\/.*$/gm, "");
  return (JSON.parse(json) as { name?: string }).name ?? "libby-reading-list";
}

function detectBranch(): string | undefined {
  // CI environment variables (try multiple providers)
  const envVars = [
    "CF_PAGES_BRANCH",
    "CF_BRANCH",
    "WORKERS_CI_BRANCH",
    "GITHUB_HEAD_REF",
    "GITHUB_REF_NAME",
  ];
  for (const key of envVars) {
    const val = process.env[key]?.trim();
    if (val) return val;
  }

  // Git: try current branch first, then fall back to detached HEAD detection
  try {
    const current = execSync("git branch --show-current", {
      cwd: root,
      encoding: "utf-8",
    }).trim();
    if (current) return current;
  } catch {
    // ignore
  }

  // Detached HEAD: parse symbolic ref names pointing at HEAD
  try {
    const refs = execSync("git log -1 --format=%D", { cwd: root, encoding: "utf-8" }).trim();
    // e.g. "HEAD, origin/fix-cloudflare" → extract branch name
    for (const ref of refs.split(",")) {
      const match = ref.trim().match(/^origin\/(.+)/);
      if (match) return match[1];
    }
  } catch {
    // ignore
  }

  return undefined;
}

function sanitizeBranch(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const args = process.argv.slice(2);
const nameIdx = args.indexOf("--name");
const nameOverride = nameIdx !== -1 ? args[nameIdx + 1] : undefined;

const baseWorkerName = readWorkerName();
const productionBranch = process.env.CF_PRODUCTION_BRANCH ?? "main";
const branch = detectBranch();
const isProduction = !branch || branch === productionBranch;

const workerName =
  nameOverride ?? (isProduction ? baseWorkerName : `${sanitizeBranch(branch)}-${baseWorkerName}`);
const subdomain = process.env.CF_WORKERS_SUBDOMAIN ?? "nowell.workers.dev";
const siteUrl = `https://${workerName}.${subdomain}`;

console.log(
  `Branch      : ${branch ?? "(unknown)"} ${isProduction ? "(production)" : "(preview)"}`,
);
console.log(`Worker name : ${workerName}`);
console.log(`Site URL    : ${siteUrl}`);
console.log();

execSync("npm run build", {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, VITE_SITE_URL: siteUrl },
});
