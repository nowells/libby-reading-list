---
name: changelog-entry
description: Author or finalize a PR's user-facing Changelog block for nowells/libby-reading-list (ShelfCheck). Use whenever opening, drafting, or amending a pull request description so downstream tooling can publish it as a standard.site post that ShelfCheck and other services render inline as a "What's new" notification. Triggers on phrases like "open a PR", "update the PR description", "summarize this PR for users", "what should the changelog say", or "this PR is missing a changelog".
---

# Changelog entry for every PR

Every PR opened against `main` must carry a `## Changelog` block in its
description. A downstream publisher reads that block from merged PRs and posts
it as a [standard.site](https://standard.site) changelog entry, which
`www.shelfcheck.org` and other consumers render inline as a "What's new"
notification.

The audience for this block is **the person using ShelfCheck**, not the
developer reviewing the PR. They don't know what a route loader is — they know
they tried to import their library and the page crashed. Write for them.

## When this skill applies

Run through this skill on every PR opened against `main`, including:

- New user-visible features
- Bug fixes a user could plausibly notice
- Performance or reliability improvements with observable effects
- UI / copy / accessibility changes
- Breaking changes (renamed routes, changed CSV column expectations, etc.)

A PR may use `category: skip` only when it has **zero** user-visible impact.
Examples that may legitimately skip:

- Pure refactors with identical observable behavior
- CI / lint / formatting / dev-tooling changes
- Internal type tightening, code comments, README edits
- VRT screenshot updates (`chore: update VRT screenshots`)
- Dependency bumps with no behavior change

If you're not sure, write the entry. `skip` is the exception, not the default.

## Required block format

Append this block at the end of the PR description, after the standard
`## Summary` and `## Test plan` sections:

    ## Changelog

    ```yaml
    category: <added | improved | fixed | changed | removed | skip>
    title: <≤60 chars, sentence case, no trailing period, no PR/issue refs>
    body: |
      1–3 short sentences. What changed for the user, in their words.
      Lead with the benefit. End with a concrete cue if helpful
      ("look for the ↻ icon on each book card").
    tags: [optional, lowercase, hyphenated; e.g. bluesky, libby, csv-import]
    ```

Only `category`, `title`, and `body` are required. `skip` entries need only
`category: skip` plus a one-line `body` explaining why the PR is not
user-visible — the publisher's audit log records the reason.

The block must be valid YAML inside a fenced ```yaml code block so the
publisher can parse it with a fixed regex (`## Changelog\s*```yaml([\s\S]*?)```)`.

## Voice rules

- **Address the reader as "you"**, not "the user" or "users".
- **Lead with the benefit, not the mechanism.** "Your reading list now syncs
  across devices" — not "Added ATProto OAuth-backed write path for shelf
  entries."
- **No internal nouns.** Don't say "PDS", "lexicon", "route loader", "knip",
  "VRT", "useEffect", "wrangler", "Cloudflare worker". Translate: PDS →
  "your Bluesky account"; lexicon → (omit, the reader doesn't need it);
  Cloudflare worker → (omit, infra is invisible).
- **No PR / commit / issue numbers**, no `@username`, no file paths. The
  publisher strips them anyway, and they distract reviewers reading the PR.
- **Tense:** past tense for `fixed` / `changed` / `removed`; present tense
  for `added` / `improved`. Stay consistent within one entry.
- **No emoji** unless the change literally adds an emoji to the UI.
- **Don't apologize, don't say "we" / "the team".** The standard.site feed
  already attributes posts to ShelfCheck.
- **Concrete over abstract.** "Importing a 2,000-book Goodreads export now
  finishes" beats "improved CSV import reliability".

## Categories

| Category   | Use for                                                        |
|------------|----------------------------------------------------------------|
| `added`    | Brand-new capability the reader didn't have before             |
| `improved` | Existing capability is now faster, clearer, or more accurate   |
| `fixed`    | Something that was broken now works                            |
| `changed`  | Behavior differs in a way readers will notice (incl. breaking) |
| `removed`  | A capability or surface is gone                                |
| `skip`     | No user impact — see "When this skill applies"                 |

Pick one. If a PR genuinely spans two (e.g. adds a feature *and* fixes a
related bug), file the entry under the dominant change and fold the secondary
one into `body`.

## Examples

### Good — `added`

```yaml
category: added
title: Sync your reading list across devices with Bluesky
body: |
  Sign in with Bluesky on the setup page and your "Want to read",
  "Reading", and "Finished" shelves now follow you to every device,
  along with the authors you follow and the books you've dismissed.
tags: [bluesky, sync]
```

### Good — `improved`

```yaml
category: improved
title: "Refresh All" finishes faster on big libraries
body: |
  Refreshing availability for 100+ books is noticeably quicker and
  less likely to be rate-limited by Libby. The per-book refresh icon
  still fetches the freshest numbers when you want them.
tags: [libby, performance]
```

### Good — `fixed`

```yaml
category: fixed
title: CSV imports from Goodreads no longer stall on large libraries
body: |
  Importing a 2,000-book Goodreads export used to time out partway
  through. The page now finishes the import and shows availability
  for every book.
tags: [csv-import, goodreads]
```

### Good — `skip`

```yaml
category: skip
body: Internal refactor of the availability hook; no user-visible change.
```

### Bad — too developer-y

```yaml
# DON'T
category: improved
title: Refactor useAvailabilityChecker to batch /media calls
body: |
  Replaced per-item /availability fetches with the embedded
  availableCopies / holdsCount fields on the search response,
  halving request volume.
```

Rewrite using consumer voice — see the `improved` example above.

### Bad — vague benefit

```yaml
# DON'T
category: improved
title: Better Bluesky support
body: Various improvements to the Bluesky integration.
```

Name a concrete thing the reader can now do, or that now behaves
differently for them.

## Workflow when Claude opens a PR

1. Stage and commit changes as usual.
2. Before calling `mcp__github__create_pull_request`, draft the Changelog
   block from the diff, the commit messages, and the user's stated intent.
3. Re-read the draft against the **Voice rules** above. Strip internal
   nouns. Replace mechanism with benefit.
4. Append the YAML block under `## Changelog` in the PR body, after
   `## Summary` and `## Test plan`.
5. If the change is genuinely internal-only, use `category: skip` with a
   one-line reason — don't omit the block.

## Workflow when reviewing or amending an existing PR

- If the PR is missing the `## Changelog` block, add it before merge by
  calling `mcp__github__update_pull_request` with the new body.
- If the block exists but reads like a commit message, rewrite it in
  consumer voice. If you didn't author the PR, post the rewrite as a
  suggestion comment on the PR description rather than editing in place.
- If the YAML doesn't parse (missing `category`, unquoted colons, mismatched
  indentation), fix it — the publisher will skip unparseable entries and
  they'll silently miss the next changelog post.

## Standard.site post mapping

The downstream publisher (run on PR merge) maps the YAML block to a
standard.site post as follows:

| YAML field        | standard.site field        |
|-------------------|----------------------------|
| `title`           | post title                 |
| `category`        | post label                 |
| `body`            | post body (markdown)       |
| `tags`            | post tags                  |
| merge timestamp   | post `publishedAt`         |
| PR URL            | post `sourceUrl` (private) |

`skip` entries are recorded in the publisher's audit log and **not** posted.
PRs that ship without any `## Changelog` block also land in the audit log,
flagged for follow-up — that's the failure mode this skill exists to
prevent.
