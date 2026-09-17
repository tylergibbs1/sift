import { type Cache, createCache, type KeyValueStore } from "./cache";
import { type JevClient, JevError } from "./jev/client";
import { Unit } from "./jev/schema";
import type { ScoreRequest, ScoreResponse, SerpResult } from "./messages";
import {
	INTENT_QUESTIONS,
	QUESTIONS,
	ResultScores,
	toResultScores,
} from "./rank/questions";

export type SiftCaches = {
	readonly scores: Cache<ResultScores>;
	readonly intent: Cache<Unit>;
};

export function createSiftCaches(
	store: KeyValueStore,
	options: { now?: () => number; ttlMs?: number } = {},
): SiftCaches {
	return {
		scores: createCache<ResultScores>(store, {
			...options,
			namespace: "score",
			schema: ResultScores,
			fingerprint: QUESTIONS,
		}),
		intent: createCache<Unit>(store, {
			...options,
			namespace: "intent",
			schema: Unit,
			fingerprint: INTENT_QUESTIONS,
		}),
	};
}

export type ScoringDeps = {
	readonly apiKey: string | null;
	readonly makeClient: (apiKey: string) => JevClient;
	readonly caches: SiftCaches;
	readonly log?: (message: string, error: unknown) => void;
};

/**
 * One Jev call per result plus, optionally, one for the search's intent. All
 * run concurrently, and cache hits skip the API.
 */
export async function scoreResults(
	request: ScoreRequest,
	deps: ScoringDeps,
): Promise<ScoreResponse> {
	if (!deps.apiKey) return { ok: false, reason: "no-api-key" };
	const client = deps.makeClient(deps.apiKey);
	const log = deps.log ?? (() => {});
	const query = normalizeQuery(request.query);

	const [intent, ...settled] = await Promise.allSettled([
		request.includeIntent
			? shoppingIntent(query, client, deps.caches.intent)
			: Promise.resolve(null),
		...request.results.map((r) =>
			scoreOne(query, r, client, deps.caches.scores),
		),
	]);

	const all = [intent, ...settled];
	if (all.some((s) => s.status === "rejected" && isAuthFailure(s.reason))) {
		return { ok: false, reason: "invalid-api-key" };
	}

	const scores: Record<string, ResultScores | null> = {};
	settled.forEach((s, i) => {
		const result = request.results[i];
		if (!result) return;
		if (s.status === "fulfilled") {
			scores[result.id] = s.value;
		} else {
			log(`Scoring failed for ${result.url}`, s.reason);
			scores[result.id] = null;
		}
	});
	if (intent.status === "rejected") log("Intent check failed", intent.reason);

	return {
		ok: true,
		scores,
		shoppingIntent: intent.status === "fulfilled" ? intent.value : null,
	};
}

async function scoreOne(
	query: string,
	result: SerpResult,
	client: JevClient,
	cache: Cache<ResultScores>,
): Promise<ResultScores> {
	const key = [query, result.url];
	const cached = await cache.get(key);
	if (cached) return cached;

	const state = {
		query,
		result: {
			title: result.title,
			domain: result.domain,
			url: result.url,
			snippet: result.snippet,
		},
	};
	const scores = toResultScores(await client.evaluate(state, QUESTIONS));
	await cache.set(key, scores);
	return scores;
}

async function shoppingIntent(
	query: string,
	client: JevClient,
	cache: Cache<Unit>,
): Promise<Unit> {
	const cached = await cache.get([query]);
	if (cached !== null) return cached;
	const answers = await client.evaluate({ query }, INTENT_QUESTIONS);
	await cache.set([query], answers.wants_to_buy.noul);
	return answers.wants_to_buy.noul;
}

function normalizeQuery(query: string): string {
	return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function isAuthFailure(error: unknown): boolean {
	return error instanceof JevError && error.isAuthFailure;
}
