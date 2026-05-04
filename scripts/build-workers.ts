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
 * Environment variables (set by Cloudflare Workers CI):
 *   CF_PAGES_BRANCH       – branch being built
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
  if (process.env.CF_PAGES_BRANCH) return process.env.CF_PAGES_BRANCH;
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF;
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  try {
    return execSync("git branch --show-current", { cwd: root, encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
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
