/**
 * Shared utilities for the `## Changelog` block on PR descriptions.
 *
 * Both the lint script (CI gate) and the publish script (standard.site
 * writer) extract and validate the same block via these helpers, so the
 * format defined in .claude/skills/changelog-entry/SKILL.md stays the
 * single source of truth.
 */

import { readFileSync } from "node:fs";

export type Category = "added" | "improved" | "fixed" | "changed" | "removed" | "skip";

const CATEGORIES: readonly Category[] = [
  "added",
  "improved",
  "fixed",
  "changed",
  "removed",
  "skip",
];

export interface ChangelogEntry {
  category: Category;
  title?: string;
  body: string;
  tags: string[];
}

export type ExtractResult =
  | { ok: true; entry: ChangelogEntry }
  | { ok: false; errors: string[] };

const HEADING_RE = /^##\s+changelog\s*$/im;
const FENCE_RE = /```ya?ml\s*\n([\s\S]*?)\n\s*```/;

export function extract(body: string): ExtractResult {
  const heading = body.match(HEADING_RE);
  if (!heading || heading.index === undefined) {
    return {
      ok: false,
      errors: ['missing "## Changelog" heading in PR description'],
    };
  }

  // Slice from the heading to the next top-level "## " heading (or end).
  const after = body.slice(heading.index + heading[0].length);
  const next = after.match(/^##\s+/m);
  const section = next?.index === undefined ? after : after.slice(0, next.index);

  const fence = section.match(FENCE_RE);
  if (!fence) {
    return {
      ok: false,
      errors: [
        'expected a ```yaml fenced block under "## Changelog" — see .claude/skills/changelog-entry/SKILL.md',
      ],
    };
  }

  const parsed = parseYaml(fence[1]);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  return validate(parsed.value);
}

type RawValue = string | string[];
type ParseResult = { ok: true; value: Record<string, RawValue> } | { ok: false; errors: string[] };

/**
 * Tiny parser for the documented changelog YAML shape. Supports only:
 *   key: scalar
 *   key: "quoted scalar"
 *   key: |          (literal block scalar — preserves newlines)
 *   key: [a, b, c]  (flow sequence of scalars)
 *   key:            (block sequence)
 *     - a
 *     - b
 *
 * Anything more exotic (anchors, multi-doc, nested mappings) is out of
 * scope on purpose — the format is locked by the skill.
 */
function parseYaml(raw: string): ParseResult {
  const lines = raw.replaceAll("\r\n", "\n").split("\n");
  const out: Record<string, RawValue> = {};
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    if (indent !== 0) {
      errors.push(`line ${i + 1}: unexpected indentation (top-level keys only)`);
      continue;
    }

    const m = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.*)$/);
    if (!m) {
      errors.push(`line ${i + 1}: expected "key: value", got: ${JSON.stringify(line)}`);
      continue;
    }
    const key = m[1];
    const rest = m[2];

    if (rest === "|") {
      const block: string[] = [];
      let blockIndent: number | null = null;
      let j = i + 1;
      for (; j < lines.length; j++) {
        const nextLine = lines[j];
        if (nextLine.trim() === "") {
          block.push("");
          continue;
        }
        const ni = nextLine.length - nextLine.trimStart().length;
        if (ni === 0) break;
        if (blockIndent === null) blockIndent = ni;
        block.push(nextLine.slice(blockIndent));
      }
      while (block.length > 0 && block[block.length - 1] === "") block.pop();
      out[key] = block.join("\n");
      i = j - 1;
    } else if (rest === "") {
      const items: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const nextLine = lines[j];
        if (nextLine.trim() === "") continue;
        const dash = nextLine.match(/^\s+-\s+(.*)$/);
        if (!dash) break;
        items.push(unquote(dash[1].trim()));
      }
      out[key] = items;
      i = j - 1;
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      out[key] = inner === "" ? [] : inner.split(",").map((s) => unquote(s.trim()));
    } else {
      out[key] = unquote(rest);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: out };
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function validate(raw: Record<string, RawValue>): ExtractResult {
  const errors: string[] = [];

  const category = raw.category;
  if (typeof category !== "string") {
    errors.push('"category" is required');
  } else if (!(CATEGORIES as readonly string[]).includes(category)) {
    errors.push(
      `"category" must be one of: ${CATEGORIES.join(", ")} (got ${JSON.stringify(category)})`,
    );
  }

  const isSkip = category === "skip";

  const body = raw.body;
  if (typeof body !== "string" || body.trim() === "") {
    errors.push(
      isSkip
        ? '"body" is required for skip entries — give a one-line reason'
        : '"body" is required',
    );
  } else if (!isSkip && body.trim().length < 20) {
    errors.push('"body" is too short (≥20 characters of consumer-readable copy)');
  }

  let title: string | undefined;
  if (!isSkip) {
    if (typeof raw.title !== "string" || raw.title.trim() === "") {
      errors.push('"title" is required (≤60 chars, sentence case)');
    } else {
      title = raw.title.trim();
      if (title.length > 60) errors.push(`"title" is ${title.length} chars (max 60)`);
      if (title.endsWith(".")) errors.push('"title" must not end with a period');
      if (/#\d+/.test(title)) errors.push('"title" must not reference PR/issue numbers');
      if (/@\w+/.test(title)) errors.push('"title" must not contain @username refs');
    }
  } else if (raw.title !== undefined) {
    errors.push('"title" is not allowed when category is "skip"');
  }

  let tags: string[] = [];
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags)) {
      errors.push('"tags" must be a YAML list (e.g. [bluesky, sync])');
    } else {
      tags = raw.tags;
      for (const t of tags) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t)) {
          errors.push(`tag ${JSON.stringify(t)} must be lowercase, hyphen-separated`);
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    entry: {
      category: category as Category,
      title,
      body: (body as string).trim(),
      tags,
    },
  };
}

/**
 * Resolve the PR body from CLI flags or stdin.
 *   --body-file <path>    read file
 *   --body-env  <name>    read env var (preferred for CI — no shell escaping)
 *   --body      <string>  literal
 *   (otherwise)           read stdin if piped
 */
export function readBody(argv: string[]): string {
  const fileIdx = argv.indexOf("--body-file");
  if (fileIdx !== -1 && argv[fileIdx + 1]) {
    return readFileSync(argv[fileIdx + 1], "utf-8");
  }
  const envIdx = argv.indexOf("--body-env");
  if (envIdx !== -1 && argv[envIdx + 1]) {
    const name = argv[envIdx + 1];
    const v = process.env[name];
    if (v === undefined) {
      console.error(`Env var ${name} is not set`);
      process.exit(1);
    }
    return v;
  }
  const litIdx = argv.indexOf("--body");
  if (litIdx !== -1 && argv[litIdx + 1] !== undefined) {
    return argv[litIdx + 1];
  }
  if (!process.stdin.isTTY) {
    return readFileSync(0, "utf-8");
  }
  console.error(
    "usage: --body-file <path> | --body-env <name> | --body <string> (or pipe via stdin)",
  );
  process.exit(1);
}
