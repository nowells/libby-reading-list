# ShelfCheck

Find your "Want to Read" books that are available at your local library through Libby — and keep your reading list synced across devices via the AT Protocol.

Upload a CSV export from **Goodreads**, **Hardcover**, or **The StoryGraph**, sign in with **Bluesky** to store your reading list on your PDS, or import once from **BookHive** — then instantly see which books you can borrow right now.

**Live at [www.shelfcheck.org](https://www.shelfcheck.org)**

## How it works

1. Import your reading list — CSV from Goodreads, Hardcover, or The StoryGraph, or sign in with Bluesky to sync your books, followed authors, and dismissed works as `org.shelfcheck.*` records on your PDS
2. Search for and add your local Libby libraries (supports multiple)
3. See real-time availability for each book, with direct links to borrow in Libby

When signed in with Bluesky, ShelfCheck mirrors your reading list to your PDS so it follows you across devices and other compatible AT Protocol clients. Without an account, everything still works — data just stays in browser localStorage.

## Lexicon

ShelfCheck publishes its own AT Protocol lexicon under `org.shelfcheck.*`. The schema files are hosted at:

- [`org.shelfcheck.defs`](https://www.shelfcheck.org/lexicons/org.shelfcheck.defs.json) — shared status tokens, book identifiers, structured author refs
- [`org.shelfcheck.shelf.entry`](https://www.shelfcheck.org/lexicons/org.shelfcheck.shelf.entry.json) — a book on your shelf with status (`wantToRead | reading | finished | abandoned`), dates, rating, notes
- [`org.shelfcheck.author.follow`](https://www.shelfcheck.org/lexicons/org.shelfcheck.author.follow.json) — an author you follow for new-release tracking
- [`org.shelfcheck.book.dismissed`](https://www.shelfcheck.org/lexicons/org.shelfcheck.book.dismissed.json) — a work you've explicitly hidden from suggestions

Open Library Work ID is the primary correlation key, with ISBN-13 / hiveId / Goodreads ID as secondary identifiers. Authors are structured (`{ name, olAuthorKey? }`), not tab-joined strings. Records are independently typed so reviews, ratings, and shelf state don't get mixed into one mega-record.

Lexicon source: [`public/lexicons/`](public/lexicons/).

### Registering the lexicons on the network

Hosting the JSON files on shelfcheck.org is enough for humans, but tools
like [atproto.at](https://atproto.at) and `lexicon.store` resolve schemas
through the AT Protocol's lexicon-resolution mechanism instead. Two pieces
have to be in place for `org.shelfcheck.*` to stop showing up as
"Unknown Schema":

1. **Publish each lexicon as a `com.atproto.lexicon.schema` record** under
   a DID we control. The rkey for each record is the NSID itself (e.g.
   `org.shelfcheck.shelf.entry`). Run:

   ```bash
   ATPROTO_HANDLE=you.bsky.social \
   ATPROTO_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
   npm run publish:lexicons
   ```

   Create the app password at
   [bsky.app/settings/app-passwords](https://bsky.app/settings/app-passwords).
   Override `ATPROTO_PDS` if the account lives on a non-Bluesky PDS. The
   script reads every `*.json` in `public/lexicons/` and upserts it; re-run
   it whenever a schema changes.

2. **Add a DNS TXT record** authorizing that DID for the `org.shelfcheck`
   namespace. At the `shelfcheck.org` registrar, create:

   | Host                   | Type | Value                          |
   | ---------------------- | ---- | ------------------------------ |
   | `_lexicon.shelfcheck.org` | TXT  | `did=did:plc:<your-did-here>` |

   The authority part of the NSID (`org.shelfcheck`) is reversed to derive
   the domain (`shelfcheck.org`), and resolvers look up
   `_lexicon.<domain>` to find the DID that's allowed to define the
   schema. The publish script prints the exact value to use after a
   successful login. Propagation usually takes a few minutes; once it's
   live, atproto.at will render the schema instead of "Unknown Schema".

## Exporting your reading list

### Goodreads

1. Go to [goodreads.com/review/import](https://www.goodreads.com/review/import)
2. Click "Export Library" at the top
3. Wait for the export to complete, then download the CSV

### Hardcover

1. Go to [hardcover.app/account/exports](https://hardcover.app/account/exports)
2. Click "Export" to generate a CSV
3. Download the file when ready

### The StoryGraph

1. Go to [app.thestorygraph.com/manage_account](https://app.thestorygraph.com/manage_account)
2. Scroll to the "Manage Your Data" section
3. Click "Export StoryGraph Library" and download the CSV

### Bluesky (ATProto sync)

Sign in with your Bluesky handle on the setup page. ShelfCheck reads and
writes its own `org.shelfcheck.*` records on your PDS via ATProto OAuth, so
your reading list, followed authors, and dismissed works stay in sync
across devices. Reconciliation runs automatically on every visit when a
session is restored, and on demand via the sync pill on the books page.

### BookHive (one-time migration)

If you previously used [BookHive](https://bookhive.buzz), the setup page
offers a one-time **Import from BookHive** button after you sign in with
Bluesky. ShelfCheck reads your `buzz.bookhive.book` records (status
`wantToRead`) and writes them as `org.shelfcheck.shelf.entry` records on
your PDS. From that point on ShelfCheck only touches its own collection;
your existing BookHive records remain readable by BookHive.

## Notes on Libby request volume

Bulk loads and the "Refresh All" button rely on availability fields
embedded in Libby's `/media` search response (`availableCopies`,
`holdsCount`, `isAvailable`, `estimatedWaitDays`) instead of issuing a
separate `/availability` request per matching item. This roughly halves
the request count and keeps the page fast on libraries of 100+ books,
but the search-embedded numbers may be a few minutes more cached on
Libby's CDN than the canonical endpoint.

The per-book Refresh button (the small ↻ in each card's footer) hits
the canonical `/libraries/<key>/media/<id>/availability` endpoint, so
when you specifically want the freshest numbers for one title you'll
get them. If we ever observe enough drift between the two to mislead
users, the easy fix is to flip the bulk path to live availability by
default — search for `liveAvailability` in `app/lib/libby.ts` and
`app/routes/books/hooks/use-availability-checker.ts`.

## Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173`.

## Building

```bash
npm run build
```

Output is a static site in `build/client/`, deployable anywhere that serves static files.

## Deployment

Pushes to `main` automatically deploy to GitHub Pages via GitHub Actions.

## License

ShelfCheck is released under the [MIT License](LICENCE.md).
