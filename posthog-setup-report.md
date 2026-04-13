<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into ShelfCheck, a React Router v7 Framework mode SPA. PostHog is initialized in `app/entry.client.tsx` with the `PostHogProvider` wrapping the entire app. Event tracking was added across the two core user-facing routes, error tracking was added to the root error boundary, and environment variables were configured in `.env`.

## Files changed

| File | Change |
|------|--------|
| `app/entry.client.tsx` | **Created** — initializes PostHog and wraps the app in `PostHogProvider` |
| `app/root.tsx` | Added `usePostHog` import; added `posthog?.captureException(error)` in `ErrorBoundary` |
| `app/routes/setup.tsx` | Added PostHog events for CSV upload, library search/add/remove, and full reset |
| `app/routes/books.tsx` | Added PostHog events for page view, category/format filtering, Libby link clicks, and refresh |
| `vite.config.ts` | Added `ssr.noExternal` for `posthog-js` and `@posthog/react` |
| `.env` | Added `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` and `VITE_PUBLIC_POSTHOG_HOST` |

## Events instrumented

| Event | Description | File |
|-------|-------------|------|
| `csv_uploaded` | User successfully imports a reading list CSV. Includes `format`, `book_count`, `total_rows`. | `app/routes/setup.tsx` |
| `csv_upload_failed` | CSV upload failed due to parse error or no want-to-read books found. Includes `error`, `format`, `total_rows`. | `app/routes/setup.tsx` |
| `library_searched` | User submits a library search query. Includes `query`, `result_count`. | `app/routes/setup.tsx` |
| `library_added` | User adds a Libby library. Includes `library_name`, `library_key`, `library_type`. | `app/routes/setup.tsx` |
| `library_removed` | User removes a library. Includes `library_name`, `library_key`. | `app/routes/setup.tsx` |
| `setup_reset` | User resets all data. Includes `book_count`, `library_count`. | `app/routes/setup.tsx` |
| `books_page_viewed` | User lands on the books availability page. Includes `book_count`, `library_count`, `book_source`. | `app/routes/books.tsx` |
| `category_filter_toggled` | User filters by availability category. Includes `category`, `active`. | `app/routes/books.tsx` |
| `format_filter_toggled` | User filters by format (all/ebook/audiobook). Includes `format`. | `app/routes/books.tsx` |
| `libby_link_clicked` | User clicks through to Libby — the key conversion event. Includes `book_title`, `format_type`, `is_available`. | `app/routes/books.tsx` |
| `all_books_refreshed` | User triggers a full availability refresh. Includes `book_count`, `library_count`. | `app/routes/books.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://us.posthog.com/project/379673/dashboard/1459553
- **Setup Conversion Funnel** (CSV upload → library added → books viewed): https://us.posthog.com/project/379673/insights/EB7lY9KF
- **Libby Link Clicks by Format** (key conversion, broken down by ebook/audiobook): https://us.posthog.com/project/379673/insights/OSH2pyWq
- **CSV Upload Success vs Failure** (import UX health over time): https://us.posthog.com/project/379673/insights/S9p9IUjo
- **Format Filter Usage** (pie chart of ebook vs audiobook preference): https://us.posthog.com/project/379673/insights/pKEKsJO8
- **Category Filter Usage** (which availability categories users care about most): https://us.posthog.com/project/379673/insights/YSLOSApK

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
