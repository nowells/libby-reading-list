# HardcoverLibby

Find your "Want to Read" books that are available at your local library through Libby.

Upload a CSV export from **Goodreads** or **Hardcover**, select your library, and instantly see which books you can borrow right now.

**Live at [libby.strite.org](https://libby.strite.org)**

## How it works

1. Export your reading list as a CSV from Goodreads or Hardcover
2. Upload the CSV — the app automatically detects the format and filters to your "want to read" shelf
3. Search for and select your local Libby library
4. See real-time availability for each book, with direct links to borrow in Libby

All data stays in your browser (localStorage). No server, no accounts, no API keys required.

## Exporting your reading list

### Goodreads

1. Go to [goodreads.com/review/import](https://www.goodreads.com/review/import)
2. Click "Export Library" at the top
3. Wait for the export to complete, then download the CSV

### Hardcover

1. Go to [hardcover.app/account/exports](https://hardcover.app/account/exports)
2. Click "Export" to generate a CSV
3. Download the file when ready

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
