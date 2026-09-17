import type { SerpResult } from "../messages";
import { siteDomainOf } from "../rules";
import { resultUrlFromHref } from "./links";
import { SELECTORS } from "./selectors";

export type ScrapedResult = {
	readonly result: SerpResult;
	readonly block: HTMLElement;
};

export function readQuery(doc: Document): string | null {
	const fromUrl = new URL(doc.location.href).searchParams.get("q");
	const input = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(
		SELECTORS.queryInput,
	);
	const query = (fromUrl ?? input?.value ?? "").trim();
	return query === "" ? null : query;
}

/** Organic results in page order, one per result block, sponsored blocks excluded. */
export function scrapeResults(doc: Document): ScrapedResult[] {
	const root = doc.querySelector(SELECTORS.resultsRoot);
	if (!root) return [];

	const blockSelector = SELECTORS.resultBlock.find((s) =>
		root.querySelector(s),
	);
	if (!blockSelector) return [];

	const seen = new Set<HTMLElement>();
	const out: ScrapedResult[] = [];
	for (const heading of root.querySelectorAll<HTMLElement>(SELECTORS.title)) {
		const block = outermostBlock(heading, blockSelector, root);
		if (!block || seen.has(block)) continue;
		seen.add(block);
		if (block.closest(SELECTORS.sponsored)) continue;

		const link = heading.closest<HTMLAnchorElement>("a[href]");
		const url = link ? resultUrlFromHref(link.href) : null;
		const domain = url && siteDomainOf(url.href);
		if (!url || !domain) continue;

		out.push({
			block,
			result: {
				id: `r${out.length}`,
				url: url.href,
				domain,
				title: text(heading),
				snippet: text(firstMatch(block, SELECTORS.snippet)),
			},
		});
	}
	return out;
}

/** Google nests result blocks (e.g. sitelinks); reorder the outermost one inside the results root. */
function outermostBlock(
	el: HTMLElement,
	selector: string,
	root: Element,
): HTMLElement | null {
	let found: HTMLElement | null = null;
	let current = el.closest<HTMLElement>(selector);
	while (current && root.contains(current) && current !== root) {
		found = current;
		current = current.parentElement?.closest<HTMLElement>(selector) ?? null;
	}
	return found;
}

function firstMatch(el: Element, selectors: readonly string[]): Element | null {
	for (const s of selectors) {
		const match = el.querySelector(s);
		if (match) return match;
	}
	return null;
}

function text(el: Element | null): string {
	return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}
