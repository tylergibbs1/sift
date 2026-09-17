/**
 * Live check against the Jev API with hand-written sample results.
 * Usage: JEV_API_KEY=... npm run smoke
 */
import { createJevClient } from "../src/jev/client";
import type { SerpResult } from "../src/messages";
import { planPage } from "../src/rank/plan";
import {
	INTENT_QUESTIONS,
	QUESTIONS,
	SHOPPING_INTENT_THRESHOLD,
	toResultScores,
} from "../src/rank/questions";
import { SiteDomain } from "../src/rules";
import { DEFAULT_SETTINGS } from "../src/settings";

const apiKey = process.env.JEV_API_KEY;
if (!apiKey) {
	console.error("Set JEV_API_KEY to run the smoke test.");
	process.exit(1);
}

const query = "best standing desk for a small apartment";
const results: SerpResult[] = [
	{
		id: "shop",
		url: "https://www.uplift-desks.example/standing-desks/sale",
		domain: SiteDomain.parse("uplift-desks.example"),
		title: "Standing Desks On Sale | Free Shipping | Shop Now",
		snippet:
			"Save up to 40% on our best-selling electric standing desks. Order today and get free delivery plus a 10-year warranty.",
	},
	{
		id: "listicle",
		url: "https://topreviewsdaily.example/best-standing-desks-2026",
		domain: SiteDomain.parse("topreviewsdaily.example"),
		title: "15 Best Standing Desks of 2026 (Top Picks & Buying Guide)",
		snippet:
			"Looking for the best standing desk? We've rounded up the 15 best standing desks you can buy right now. #1 will surprise you!",
	},
	{
		id: "forum",
		url: "https://www.reddit.com/r/malelivingspace/comments/abc/standing_desk_for_tiny_studio",
		domain: SiteDomain.parse("reddit.com"),
		title: "Standing desk for a tiny studio? : r/malelivingspace",
		snippet:
			'I have about 40 inches of wall space. Tried a 48" frame and it blocked the closet; ended up with a 40" single-motor desk that...',
	},
	{
		id: "lab",
		url: "https://www.rtings.example/desk/tests/stability",
		domain: SiteDomain.parse("rtings.example"),
		title: "Standing Desk Stability Test: We Measured Wobble on 38 Desks",
		snippet:
			"Our methodology: each desk is raised to 46 inches and loaded with 50 lb; we record oscillation with an accelerometer. Compact frames under 42 inches...",
	},
];

const client = createJevClient({ apiKey });
const started = Date.now();
const scored = await Promise.all(
	results.map(async (r) => {
		const state = {
			query,
			result: {
				title: r.title,
				domain: r.domain,
				url: r.url,
				snippet: r.snippet,
			},
		};
		return [
			r.id,
			toResultScores(await client.evaluate(state, QUESTIONS)),
		] as const;
	}),
);
const byId = new Map(scored);
console.log(`Scored ${results.length} results in ${Date.now() - started} ms\n`);
console.table(Object.fromEntries(scored.map(([id, s]) => [id, round(s)])));

const plan = planPage(
	results,
	{
		scoresFor: (r) => byId.get(r.id) ?? null,
		ruleFor: () => null,
		shopping: false,
	},
	DEFAULT_SETTINGS,
);
console.log("\nVisible order:");
for (const p of plan.visible) {
	const note =
		p.verdict.kind === "dim" ? `  [dimmed: ${p.verdict.reason}]` : "";
	console.log(`  ${p.composite?.toFixed(3)}  ${p.item.id}${note}`);
}
console.log("Hidden:");
for (const p of plan.hidden) {
	if (p.verdict.kind === "hide")
		console.log(`  ${p.item.id}  (${p.verdict.reason})`);
}

const INTENT_PROBES = [
	["best vpn", false],
	["best standing desk for a small apartment", false],
	["how to get rid of fruit flies", false],
	["buy nike pegasus 41", true],
	["pizza delivery near me", true],
	["airpods pro 2 price", true],
] as const;
console.log(`\nShopping intent (threshold ${SHOPPING_INTENT_THRESHOLD}):`);
const intents = await Promise.all(
	INTENT_PROBES.map(async ([query, expected]) => {
		const a = await client.evaluate({ query }, INTENT_QUESTIONS);
		const shopping = a.wants_to_buy.noul >= SHOPPING_INTENT_THRESHOLD;
		return { query, p: a.wants_to_buy.noul, ok: shopping === expected };
	}),
);
for (const { query, p, ok } of intents) {
	console.log(`  ${ok ? "ok  " : "MISS"} ${p.toFixed(2)}  ${query}`);
}

function round(o: Record<string, number>) {
	return Object.fromEntries(
		Object.entries(o).map(([k, v]) => [k, Number(v.toFixed(2))]),
	);
}
