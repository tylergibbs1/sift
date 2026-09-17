import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { planPage, summarizeChanges } from "../src/rank/plan";
import { explain } from "../src/serp/explain";
import { applyPlan } from "../src/serp/render";
import {
	readQuery,
	type ScrapedResult,
	scrapeResults,
} from "../src/serp/scrape";
import { showChangesToast } from "../src/serp/toast";
import { DEFAULT_SETTINGS } from "../src/settings";
import { scores } from "./helpers";

const FIXTURE = readFileSync(
	join(import.meta.dirname, "fixtures/serp.html"),
	"utf8",
);

function load(): Document {
	const dom = new JSDOM(FIXTURE, {
		url: "https://www.google.com/search?q=best+standing+desk",
	});
	// render.ts uses the global Node constants.
	globalThis.Node ??= dom.window.Node;
	return dom.window.document;
}

const namesIn = (root: ParentNode) =>
	[...root.querySelectorAll<HTMLElement>(".MjjYud[data-name]")]
		.filter((el) => !el.closest("details"))
		.map((el) => el.dataset.name);

describe("scrapeResults", () => {
	it("reads the query from the URL", () => {
		expect(readQuery(load())).toBe("best standing desk");
	});

	it("returns organic results only, one per outer block", () => {
		const results = scrapeResults(load()).map((r) => r.result);
		expect(results).toEqual([
			{
				id: "r0",
				url: "https://www.deskshop.example/buy",
				domain: "deskshop.example",
				title: "Buy Desks Now",
				snippet: "Free shipping on all desks.",
			},
			{
				id: "r1",
				url: "https://forum.example/t/desks",
				domain: "forum.example",
				title: "Which desk did you pick?",
				snippet: "I ended up with...",
			},
			{
				id: "r2",
				url: "https://reviews.example/desks",
				domain: "reviews.example",
				title: "We tested 40 desks",
				snippet: "Lab measurements of wobble.",
			},
			{
				id: "r3",
				url: "https://www.reddit.com/r/desks/comments/1",
				domain: "reddit.com",
				title: "My desk setup",
				snippet: "Two years in...",
			},
		]);
	});
});

describe("applyPlan", () => {
	function render(table: Record<string, ReturnType<typeof scores> | null>) {
		const doc = load();
		const scraped = scrapeResults(doc);
		const name = (s: ScrapedResult) => s.block.dataset.name ?? "";
		const plan = planPage(
			scraped,
			{
				scoresFor: (s) => table[name(s)] ?? null,
				ruleFor: () => null,
				shopping: false,
			},
			DEFAULT_SETTINGS,
		);
		const explained: string[] = [];
		const applied = applyPlan(doc, plan, "instant", (p) =>
			explained.push(name(p.item)),
		);
		return Object.assign(doc, { applied, scraped, plan, explained });
	}

	it("reorders blocks across different parents and folds hidden ones", () => {
		const doc = render({
			shop: scores({ promotional: 0.97 }),
			forum: scores({ answersQuery: 0.6 }),
			review: scores({ answersQuery: 0.95, depth: 1 }),
		});
		const rso = doc.getElementById("rso") as HTMLElement;
		expect(namesIn(rso)).toEqual(["review", "forum", "redirect", "images"]);

		const hidden = rso.querySelector("details.sift-hidden");
		expect(hidden?.querySelector("summary")?.textContent).toBe(
			"Show 1 hidden result",
		);
		expect(hidden?.querySelector<HTMLElement>(".MjjYud")?.dataset.name).toBe(
			"shop",
		);
		expect(hidden?.querySelector(".sift-badge")?.textContent).toBe(
			"promotional 97%",
		);
		// The hidden fold sits after the last visible result that was scraped.
		const images = rso.querySelector("[data-name=images]");
		expect(
			hidden &&
				images &&
				hidden.compareDocumentPosition(images) &
					Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(doc.getElementById("tads")?.textContent).toContain("Sponsored Desk");
	});

	it("dims low-confidence flags instead of hiding them", () => {
		const doc = render({
			shop: scores({ promotional: 0.97, pageTypeConfidence: 0.2 }),
			forum: null,
			review: scores(),
		});
		const shop = doc.querySelector<HTMLElement>("[data-name=shop]");
		expect(shop?.classList.contains("sift-dim")).toBe(true);
		expect(doc.querySelector("details")).toBeNull();
		expect(namesIn(doc.getElementById("rso") as HTMLElement)).toEqual([
			"review",
			"forum",
			"shop",
			"redirect",
			"images",
		]);
	});

	it("reverts to exactly what Google served, and can re-apply", () => {
		const table = {
			shop: scores({ promotional: 0.97 }),
			forum: scores({
				answersQuery: 0.6,
				seoFiller: 0.9,
				pageTypeConfidence: 0.1,
			}),
			review: scores({ answersQuery: 0.95, depth: 1 }),
		};
		const pristine = load().body.innerHTML;
		const doc = render(table);
		expect(doc.body.innerHTML).not.toBe(pristine);

		doc.applied.revert();
		expect(doc.body.innerHTML).toBe(pristine);

		applyPlan(doc, doc.plan, "instant", () => {});
		expect(namesIn(doc.getElementById("rso") as HTMLElement)).toEqual([
			"review",
			"forum",
			"redirect",
			"images",
		]);
		expect(doc.querySelectorAll(".sift-badge")).toHaveLength(2);
	});

	it("opens the explainer from badges and from 'Why here?'", () => {
		const doc = render({
			shop: scores({ promotional: 0.97, pageTypeConfidence: 0.2 }),
			review: scores(),
		});
		const shop = doc.querySelector("[data-name=shop]");
		const review = doc.querySelector("[data-name=review]");
		const redirect = doc.querySelector("[data-name=redirect]");
		shop?.querySelector<HTMLElement>(".sift-badge")?.click();
		review?.querySelector<HTMLElement>(".sift-why")?.click();
		expect(doc.explained).toEqual(["shop", "review"]);
		// Unscored results get no button: there's nothing to explain.
		expect(redirect?.querySelector("button")).toBeNull();
	});
});

describe("changes toast", () => {
	it("summarizes the changes and toggles the original order", () => {
		const doc = load();
		const scraped = scrapeResults(doc);
		const table = [
			scores({ promotional: 0.97 }),
			scores({ answersQuery: 0.1, seoFiller: 0.9, pageTypeConfidence: 0.1 }),
			scores({ answersQuery: 0.95 }),
		];
		const plan = planPage(
			scraped,
			{
				scoresFor: (s) => table[scraped.indexOf(s)] ?? null,
				ruleFor: () => null,
				shopping: true,
			},
			DEFAULT_SETTINGS,
		);
		const changes = summarizeChanges(scraped, plan);
		// A shopping search keeps the sales page instead of hiding it.
		expect(changes).toEqual({
			moved: 3,
			hidden: 0,
			dimmed: 1,
			boosted: 0,
			shopping: true,
		});

		const calls: string[] = [];
		showChangesToast(
			doc,
			changes,
			{
				showOriginal: () => calls.push("original"),
				reapply: () => calls.push("reapply"),
			},
			"instant",
		);
		const shadow = doc.querySelector("sift-toast")?.shadowRoot;
		const text = () => shadow?.querySelector(".panel")?.textContent;
		expect(text()).toContain("Shopping search · reordered 3 · dimmed 1");

		const [toggle, close] = shadow?.querySelectorAll("button") ?? [];
		toggle?.click();
		expect(text()).toContain("Google's order");
		toggle?.click();
		expect(calls).toEqual(["original", "reapply"]);

		close?.click();
		expect(doc.querySelector("sift-toast")).toBeNull();
	});
});

describe("explain", () => {
	const doc = load();
	const [first] = scrapeResults(doc);
	if (!first) throw new Error("fixture has no results");
	const base = { item: first, composite: 0.72, rule: null } as const;
	const context = { shopping: false, discussionWeight: 0 };

	it("lists every factor with its effect on rank", () => {
		const e = explain(
			{
				...base,
				scores: scores({ answersQuery: 0.82 }),
				verdict: { kind: "keep" },
			},
			context,
		);
		expect(e.headline).toBe("Rank score 72");
		expect(e.detail).toBe("Sift is 90% sure what kind of page this is.");
		expect(e.rows.map((r) => [r.label, r.value, r.effect])).toEqual([
			["Answers the question", 0.82, "raises"],
			["Depth", 0.5, "raises"],
			["Selling something", 0.1, "lowers"],
			["SEO filler", 0.1, "lowers"],
			["Forum or Q&A", 0.1, "none"],
		]);
	});

	it("explains that selling isn't penalized on shopping searches", () => {
		const e = explain(
			{ ...base, scores: scores(), verdict: { kind: "keep" } },
			{ shopping: true, discussionWeight: 0.3 },
		);
		const selling = e.rows.find((r) => r.label === "Selling something");
		expect(selling).toMatchObject({
			effect: "none",
			note: "Not a penalty on a shopping search",
		});
		expect(e.rows.at(-1)?.effect).toBe("raises");
	});

	it("explains rules and unscored results without rows", () => {
		expect(
			explain(
				{
					...base,
					scores: null,
					composite: null,
					rule: "boost",
					verdict: { kind: "boost", reason: "Boosted by you" },
				},
				context,
			),
		).toEqual({
			headline: "Your rule",
			detail: "You chose to always boost this site.",
			rows: [],
		});
		expect(
			explain(
				{ ...base, scores: null, composite: null, verdict: { kind: "keep" } },
				context,
			).headline,
		).toBe("Not scored");
	});
});
