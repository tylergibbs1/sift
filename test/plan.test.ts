import {
	composite,
	hasChanges,
	planPage,
	summarizeChanges,
	verdict,
} from "../src/rank/plan";
import type {
	ResultScores,
	ResultScores as Scores,
} from "../src/rank/questions";
import type { SiteRule } from "../src/rules";
import { DEFAULT_SETTINGS, Settings } from "../src/settings";
import { scores } from "./helpers";

const only = <T>(scoresFor: (item: T) => Scores | null) => ({
	scoresFor,
	ruleFor: () => null,
	shopping: false,
});

const settings = (overrides: object = {}) =>
	Settings.parse({ ...DEFAULT_SETTINGS, ...overrides });

describe("composite", () => {
	it("applies the default weights", () => {
		const s = scores({
			answersQuery: 1,
			depth: 1,
			promotional: 0,
			seoFiller: 0,
		});
		expect(composite(s, DEFAULT_SETTINGS.weights)).toBeCloseTo(1);

		const t = scores({
			answersQuery: 0.5,
			depth: 0,
			promotional: 1,
			seoFiller: 0,
		});
		// (0.45*0.5 + 0.30*0 + 0.15*0 + 0.10*1) / 1.0
		expect(composite(t, DEFAULT_SETTINGS.weights)).toBeCloseTo(0.325);
	});

	it("boosts discussions only when that weight is set", () => {
		const forum = scores({ discussion: 1 });
		const article = scores({ discussion: 0 });
		const base = DEFAULT_SETTINGS.weights;
		expect(composite(forum, base)).toBe(composite(article, base));
		const boosted = { ...base, discussion: 0.3 };
		expect(composite(forum, boosted)).toBeGreaterThan(
			composite(article, boosted),
		);
	});

	it("returns 0 when every weight is 0", () => {
		const zero = {
			answersQuery: 0,
			depth: 0,
			notPromotional: 0,
			notSeoFiller: 0,
			discussion: 0,
		};
		expect(composite(scores(), zero)).toBe(0);
	});
});

describe("verdict", () => {
	it("keeps unflagged results", () => {
		expect(verdict(scores(), DEFAULT_SETTINGS)).toEqual({ kind: "keep" });
	});

	it("hides confidently flagged results", () => {
		const v = verdict(scores({ promotional: 0.9 }), DEFAULT_SETTINGS);
		expect(v).toEqual({ kind: "hide", reason: "promotional 90%" });
	});

	it("only dims flagged results when confidence is low", () => {
		const v = verdict(
			scores({ seoFiller: 0.95, pageTypeConfidence: 0.3 }),
			DEFAULT_SETTINGS,
		);
		expect(v.kind).toBe("dim");
	});

	it("ignores flags whose filter is turned off", () => {
		const s = scores({ promotional: 0.99 });
		expect(verdict(s, settings({ hidePromotional: false }))).toEqual({
			kind: "keep",
		});
	});

	it("lists every reason", () => {
		const v = verdict(
			scores({ promotional: 0.9, seoFiller: 0.86 }),
			DEFAULT_SETTINGS,
		);
		expect(v).toMatchObject({ reason: "promotional 90%, SEO filler 86%" });
	});
});

describe("planPage", () => {
	const byName =
		(table: Record<string, ResultScores | null>) => (name: string) =>
			table[name] ?? null;
	const names = (xs: readonly { item: string }[]) => xs.map((x) => x.item);

	it("sorts by composite, highest first", () => {
		const plan = planPage(
			["low", "high", "mid"],
			only(
				byName({
					low: scores({ answersQuery: 0.1 }),
					high: scores({ answersQuery: 0.9 }),
					mid: scores({ answersQuery: 0.5 }),
				}),
			),
			DEFAULT_SETTINGS,
		);
		expect(names(plan.visible)).toEqual(["high", "mid", "low"]);
		expect(plan.hidden).toEqual([]);
	});

	it("keeps unscored results in their original slots", () => {
		const plan = planPage(
			["low", "failed", "high"],
			only(
				byName({
					low: scores({ answersQuery: 0.1 }),
					failed: null,
					high: scores({ answersQuery: 0.9 }),
				}),
			),
			DEFAULT_SETTINGS,
		);
		expect(names(plan.visible)).toEqual(["high", "failed", "low"]);
	});

	it("separates hidden results and keeps the rest ordered", () => {
		const plan = planPage(
			["ad", "good", "ok"],
			only(
				byName({
					ad: scores({ promotional: 0.95, answersQuery: 1 }),
					good: scores({ answersQuery: 0.9 }),
					ok: scores({ answersQuery: 0.4 }),
				}),
			),
			DEFAULT_SETTINGS,
		);
		expect(names(plan.visible)).toEqual(["good", "ok"]);
		expect(names(plan.hidden)).toEqual(["ad"]);
	});
});

describe("summarizeChanges", () => {
	it("reports no changes when the order already matches", () => {
		const items = ["a", "b"];
		const plan = planPage(
			items,
			only((x) => scores({ answersQuery: x === "a" ? 0.9 : 0.1 })),
			DEFAULT_SETTINGS,
		);
		const changes = summarizeChanges(items, plan);
		expect(changes).toEqual({
			moved: 0,
			hidden: 0,
			dimmed: 0,
			boosted: 0,
			shopping: false,
		});
		expect(hasChanges(changes)).toBe(false);
	});

	it("does not count results as moved just because one above them was hidden", () => {
		const items = ["ad", "a", "b"];
		const plan = planPage(
			items,
			only((x) =>
				x === "ad"
					? scores({ promotional: 0.99 })
					: scores({ answersQuery: x === "a" ? 0.9 : 0.1 }),
			),
			DEFAULT_SETTINGS,
		);
		expect(summarizeChanges(items, plan)).toEqual({
			moved: 0,
			hidden: 1,
			dimmed: 0,
			boosted: 0,
			shopping: false,
		});
	});
});

describe("site rules", () => {
	const rules: Record<string, SiteRule> = { forum: "boost", spam: "hide" };
	const plan = (items: string[], shopping = false) =>
		planPage(
			items,
			{
				scoresFor: (x) =>
					rules[x] ? null : scores({ answersQuery: x === "best" ? 0.9 : 0.2 }),
				ruleFor: (x) => rules[x] ?? null,
				shopping,
			},
			DEFAULT_SETTINGS,
		);

	it("puts boosted sites first and hides blocked ones without scores", () => {
		const p = plan(["spam", "meh", "best", "forum"]);
		expect(p.visible.map((x) => x.item)).toEqual(["forum", "best", "meh"]);
		expect(p.hidden.map((x) => x.item)).toEqual(["spam"]);
		expect(p.hidden[0]?.verdict).toEqual({
			kind: "hide",
			reason: "Hidden by you",
		});
		expect(summarizeChanges(["spam", "meh", "best", "forum"], p)).toEqual({
			// "best" keeps its place among visible results.
			moved: 2,
			hidden: 1,
			dimmed: 0,
			boosted: 1,
			shopping: false,
		});
	});
});

describe("shopping searches", () => {
	const shop = scores({ promotional: 0.97, answersQuery: 0.9 });
	const guide = scores({ promotional: 0.05, answersQuery: 0.6 });
	const run = (shopping: boolean) =>
		planPage(
			["shop", "guide"],
			{
				scoresFor: (x) => (x === "shop" ? shop : guide),
				ruleFor: () => null,
				shopping,
			},
			DEFAULT_SETTINGS,
		);

	it("hides sales pages on research searches", () => {
		expect(run(false).hidden.map((p) => p.item)).toEqual(["shop"]);
	});

	it("keeps and doesn't penalize sales pages on shopping searches", () => {
		const p = run(true);
		expect(p.hidden).toEqual([]);
		expect(p.visible.map((x) => x.item)).toEqual(["shop", "guide"]);
		expect(p.shopping).toBe(true);
	});

	it("still hides SEO filler on shopping searches", () => {
		const filler = scores({ seoFiller: 0.95 });
		const p = planPage(
			["x"],
			{ scoresFor: () => filler, ruleFor: () => null, shopping: true },
			DEFAULT_SETTINGS,
		);
		expect(p.hidden).toHaveLength(1);
	});
});
