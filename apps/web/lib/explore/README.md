# Explore references

The page ships with a bundled index (the first 12 feed pages). Everything else comes from an indexed copy of the WHOLE public feed (`lib/explore/library.ts`): a background job scrapes every feed page, trims it, stores one snapshot in R2 (`explore/library/v1.json`) and keeps it in memory. `/api/explore` filters that copy locally, so search, category and length filters answer in milliseconds and page through every match; the first request after a deploy builds the snapshot on its own, and a Convex cron (every 3 hours) refreshes it through `POST /api/explore/refresh` (internal secret). The page keeps the next batch fetched ahead of the scroll. Original motion and finished preview URLs are kept separate. Categories are inferred from titles and descriptions; search and bookmarks apply to loaded references. Bookmarks are local to this browser.

Refresh from the repository root:

```sh
node --experimental-strip-types apps/web/scripts/scrape-explore.mjs
```

`EXPLORE_PAGES` controls indexing depth (default 4 pages of 48, maximum 1000). The scraper indexes media links and metadata without downloading video files. Higgspad studio was inspected but its public page did not expose a usable video feed; no Higgspad content is included.

Generation reuses the existing character motion API and agent library hook. It needs an authenticated owner, a saved character portrait, and configured Higgsfield credentials. Keep the popup open during rendering. Dismiss and influencer switching are disabled during an active generation.
