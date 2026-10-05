# Explore references

The initial index contains 192 public Higgsfield motion references. `/api/explore` paginates the rest of the public community feed with caching. Original motion and finished preview URLs are kept separate. Categories are inferred from titles and descriptions; search and bookmarks apply to loaded references. Bookmarks are local to this browser.

Refresh from the repository root:

```sh
node --experimental-strip-types apps/web/scripts/scrape-explore.mjs
```

`EXPLORE_PAGES` controls indexing depth (default 4 pages of 48, maximum 1000). The scraper indexes media links and metadata without downloading video files. Higgspad studio was inspected but its public page did not expose a usable video feed; no Higgspad content is included.

Generation reuses the existing character motion API and agent library hook. It needs an authenticated owner, a saved character portrait, and configured Higgsfield credentials. Keep the popup open during rendering. Dismiss and influencer switching are disabled during an active generation.
