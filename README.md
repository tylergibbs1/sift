# Sift

A Chrome extension (Manifest V3) that re-ranks Google results with [TypeSafe Jev](https://docs.typesafe.ai).
It moves results that answer the query to the top. It folds away sales pages and SEO filler.

## How it works

1. `content.ts` scrapes the organic results on `google.com/search`. Sponsored blocks are skipped.
2. The service worker sends one Jev call per result, and all calls run at the same time. Each call asks five
   atomic questions (`src/rank/questions.ts`): four Noul questions (answers the query, promotional,
   SEO filler, discussion) and one Score question (depth, 0 to 3, normalized to 0 to 1).
3. `src/rank/plan.ts` combines the answers into a weighted score and sorts the results, highest first.
   - A result is flagged when its promotional or filler probability is at or above `flagThreshold`
     (default 0.85).
   - A flagged result is hidden only when the depth answer's confidence is at or above
     `hideMinConfidence` (default 0.6). Otherwise the result is dimmed.
   - A result whose scoring failed stays in its original position.
4. `src/serp/render.ts` reorders the page, adds a reason badge to each flagged result, and puts the
   hidden results under a "Show N hidden results" toggle. The results glide to their new positions,
   so you can see what moved.
5. `src/serp/toast.ts` shows a translucent panel in the corner when the page changed, for example
   "Reordered 3 · hid 2". Its **Show original** button restores Google's order exactly, and
   **Re-apply** reorders the results again.

## Features

- **Search intent.** Each search gets one extra question: is it transactional ("buy nike pegasus 41",
  "pizza delivery near me")? If so, sales pages are not hidden and not penalized. A research search
  like "best vpn" still filters them.
- **Site rules.** Always boost or always hide a site. You can set a rule from a result's badge or its
  "Why here?" button, or from the **Sift** right-click menu on a result link. Rules are synced
  with `chrome.storage.sync` and apply without an API call. An open results page re-ranks as soon as a rule
  changes. The settings page lists the rules and lets you remove them.
- **"Why this rank?" popover.** Click a badge, or the "Why here?" button that appears when you hover over a
  result. The popover shows every factor with its value and whether it raises or lowers the rank.

The motion follows Apple's fluid-interface guidance:

- Springs are critically damped (`src/serp/motion.ts`), so nothing overshoots.
- An interrupted animation starts from the element's current position on screen.
- The panel arrives from the bottom and leaves the same way.
- With reduced motion, the panel fades instead of moving, and results are placed without a glide.
- With reduced transparency or increased contrast, surfaces become solid.

Scores are cached in `chrome.storage.local` for 7 days. The cache key is a hash of the question set,
the query, and the URL, so a change to a question discards the old scores automatically.
On 429 and 529 responses, the client retries with exponential backoff and jitter.

## Setup

```sh
npm install
npm run build        # outputs dist/
```

To load the extension:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select `dist/`.
3. On the options page, which opens on install, enter your TypeSafe API key.

The key is stored in `chrome.storage.local`. It is not in the package and it is not synced.

## Development

| Command | Purpose |
| --- | --- |
| `npm run check` | Lint, type-check, test, and build. Run this before you commit. |
| `npm run watch` | Rebuild on change. |
| `npm run fix` | Apply Biome formatting and safe lint fixes. |
| `JEV_API_KEY=... npm run smoke` | Score sample results with the live API. Use it to tune question wording. |

## When Google changes its markup

All DOM assumptions are in `src/serp/selectors.ts`. When results stop being re-ranked:

1. Save a real results page.
2. Update `test/fixtures/serp.html` to match the new markup.
3. Update the selectors until `test/serp.test.ts` passes.

## Known limits

- **The evidence is only the snippet.** The title, domain, URL, and snippet show sales copy and
  listicles well. They are weaker evidence for whether a page answers the query. A possible next
  step: fetch the top pages and send their first ~1,500 characters. Put this behind a setting,
  because it is slower.
- Only `www.google.com` is matched. To support other Google domains, add them to `static/manifest.json`.

## Contributing

Issues and pull requests are welcome. Before you open a pull request, run `npm run check`.
CI runs the same command.

When Google's markup changes and results stop being re-ranked, update `src/serp/selectors.ts` and
`test/fixtures/serp.html` together.

## License

[MIT](LICENSE)
