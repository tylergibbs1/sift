/**
 * Every Google DOM assumption lives here. Google changes its markup often;
 * when the extension stops finding results, this is the only file to update
 * (and test/fixtures/serp.html to match).
 */
export const SELECTORS = {
	/** Container of organic results. */
	resultsRoot: "#rso",
	/** One organic result. Tried in order; the first match on the page wins. */
	resultBlock: ["div.MjjYud", "div.g"],
	/** Result title, which Google wraps in the result link. */
	title: "a h3",
	displayUrl: "cite",
	snippet: ["[data-sncf]", ".VwiC3b", "[style*='-webkit-line-clamp']"],
	/** Paid placements. Results inside these are never scored. */
	sponsored: "#tads, #tadsb, #bottomads, [data-text-ad], [aria-label='Ads']",
	queryInput: "textarea[name='q'], input[name='q']",
} as const;
