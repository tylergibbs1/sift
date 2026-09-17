import { createCache, type KeyValueStore } from "../src/cache";
import { createJevClient } from "../src/jev/client";
import { Unit } from "../src/jev/schema";
import type { ScoreRequest } from "../src/messages";
import {
	createSiftCaches,
	type ScoringDeps,
	scoreResults,
} from "../src/scoring";
import { domain, jevResponse, jsonResponse, scores } from "./helpers";

function memoryStore(): KeyValueStore & { map: Map<string, unknown> } {
	const map = new Map<string, unknown>();
	return {
		map,
		get: async (k) => map.get(k),
		set: async (k, v) => {
			map.set(k, v);
		},
		entries: async () => [...map.entries()],
		remove: async (keys) => {
			for (const k of keys) map.delete(k);
		},
	};
}

const request: ScoreRequest = {
	type: "score-results",
	query: "  Rust   borrow checker ",
	includeIntent: true,
	results: [
		{
			id: "r0",
			url: "https://doc.rust-lang.org/book/",
			domain: domain("doc.rust-lang.org"),
			title: "The Book",
			snippet: "...",
		},
		{
			id: "r1",
			url: "https://example.com/top-10",
			domain: domain("example.com"),
			title: "Top 10",
			snippet: "...",
		},
	],
};

type Body = { state: { query: string; result?: { url: string } } };

function intentResponse(noul: number) {
	return {
		model: "jev-latest",
		answers: { wants_to_buy: { type: "noul", noul } },
	};
}

function deps(
	handler: (body: Body) => Response,
	overrides: Partial<ScoringDeps> = {},
) {
	const bodies: Body[] = [];
	const d: ScoringDeps = {
		apiKey: "sk-test",
		caches: createSiftCaches(memoryStore(), { now: () => 1_000 }),
		makeClient: (apiKey) =>
			createJevClient({
				apiKey,
				sleep: async () => {},
				fetch: async (_url, init) => {
					const body = JSON.parse(String(init?.body)) as Body;
					bodies.push(body);
					return handler(body);
				},
			}),
		log: () => {},
		...overrides,
	};
	return { d, bodies };
}

/** Response bodies can be read once, so build a fresh one per request. */
const byKind =
	(answer: () => Response, intent = 0.1) =>
	(body: Body) =>
		body.state.result ? answer() : jsonResponse(intentResponse(intent));

describe("scoreResults", () => {
	it("scores every result, checks intent, and caches both", async () => {
		const { d, bodies } = deps(
			byKind(() => jsonResponse(jevResponse({ answers_query: 0.7 })), 0.9),
		);
		const first = await scoreResults(request, d);
		expect(first).toMatchObject({ ok: true, shoppingIntent: 0.9 });
		if (!first.ok) return;
		expect(first.scores.r0?.answersQuery).toBe(0.7);
		expect(first.scores.r1?.depth).toBeCloseTo(2 / 3);
		expect(bodies).toHaveLength(3);
		expect(bodies.map((b) => b.state.query)).toEqual(
			Array(3).fill("rust borrow checker"),
		);

		const second = await scoreResults(
			{ ...request, query: "rust BORROW checker" },
			d,
		);
		expect(second).toEqual(first);
		expect(bodies).toHaveLength(3);
	});

	it("skips the intent call when not requested", async () => {
		const { d, bodies } = deps(byKind(() => jsonResponse(jevResponse())));
		const res = await scoreResults({ ...request, includeIntent: false }, d);
		expect(res).toMatchObject({ ok: true, shoppingIntent: null });
		expect(bodies.every((b) => b.state.result)).toBe(true);
	});

	it("keeps result scores when only the intent check fails", async () => {
		const { d } = deps((body) =>
			body.state.result
				? jsonResponse(jevResponse())
				: jsonResponse({ detail: "boom" }, 500),
		);
		const res = await scoreResults(request, d);
		expect(res).toMatchObject({ ok: true, shoppingIntent: null });
		expect(res.ok && res.scores.r0).toBeTruthy();
	});

	it("reports a missing API key without calling the API", async () => {
		const { d, bodies } = deps(
			byKind(() => jsonResponse(jevResponse())),
			{
				apiKey: null,
			},
		);
		expect(await scoreResults(request, d)).toEqual({
			ok: false,
			reason: "no-api-key",
		});
		expect(bodies).toHaveLength(0);
	});

	it("reports a rejected API key", async () => {
		const { d } = deps(() => jsonResponse({ detail: "no" }, 401));
		expect(await scoreResults(request, d)).toEqual({
			ok: false,
			reason: "invalid-api-key",
		});
	});

	it("marks only the failing result as unscored", async () => {
		const { d } = deps((body) =>
			body.state.result?.url.includes("example.com")
				? jsonResponse({ detail: "boom" }, 500)
				: body.state.result
					? jsonResponse(jevResponse())
					: jsonResponse(intentResponse(0.1)),
		);
		const res = await scoreResults(request, d);
		expect(res.ok && res.scores.r1).toBeNull();
		expect(res.ok && res.scores.r0).toBeTruthy();
	});
});

describe("cache", () => {
	const s = scores();
	const options = (now: () => number) => ({
		namespace: "t",
		schema: Unit,
		fingerprint: ["v1"],
		now,
		ttlMs: 100,
	});

	it("expires entries after the TTL and prunes only its own", async () => {
		const store = memoryStore();
		let now = 0;
		const cache = createCache(
			store,
			options(() => now),
		);
		await cache.set(["q"], Unit.parse(0.5));
		expect(await cache.get(["q"])).toBe(0.5);
		expect(await cache.get(["other"])).toBeNull();

		now = 100;
		expect(await cache.get(["q"])).toBeNull();
		store.map.set("unrelated", 1);
		await cache.pruneExpired();
		expect([...store.map.keys()]).toEqual(["unrelated"]);
	});

	it("misses when the fingerprint changes", async () => {
		const store = memoryStore();
		await createCache(
			store,
			options(() => 0),
		).set(["q"], Unit.parse(0.5));
		const changed = createCache(store, {
			...options(() => 0),
			fingerprint: ["v2"],
		});
		expect(await changed.get(["q"])).toBeNull();
	});

	it("treats corrupt entries as misses", async () => {
		const store = memoryStore();
		const caches = createSiftCaches(store, { now: () => 0 });
		await caches.scores.set(["q", "https://a.test/"], s);
		const [key] = [...store.map.keys()];
		store.map.set(key as string, { at: 0, value: { answersQuery: 9 } });
		expect(await caches.scores.get(["q", "https://a.test/"])).toBeNull();
	});
});
