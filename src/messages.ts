import { z } from "zod";
import { Unit } from "./jev/schema";
import { ResultScores } from "./rank/questions";
import { SiteDomain } from "./rules";

export const SerpResult = z.object({
	id: z.string().min(1),
	url: z.url(),
	domain: SiteDomain,
	title: z.string(),
	snippet: z.string(),
});
export type SerpResult = z.infer<typeof SerpResult>;

export const ScoreRequest = z.object({
	type: z.literal("score-results"),
	query: z.string().trim().min(1),
	results: z.array(SerpResult).max(20),
	/** Ask whether the search is transactional. Only needed once per page. */
	includeIntent: z.boolean(),
});
export type ScoreRequest = z.infer<typeof ScoreRequest>;

export const OpenOptionsRequest = z.object({ type: z.literal("open-options") });

export const BackgroundRequest = z.discriminatedUnion("type", [
	ScoreRequest,
	OpenOptionsRequest,
]);
export type BackgroundRequest = z.infer<typeof BackgroundRequest>;

export const ScoreResponse = z.discriminatedUnion("ok", [
	z.object({
		ok: z.literal(true),
		/** Keyed by SerpResult.id; null means that result could not be scored. */
		scores: z.record(z.string(), ResultScores.nullable()),
		/** Probability the search is transactional; null if not requested or it failed. */
		shoppingIntent: Unit.nullable(),
	}),
	z.object({
		ok: z.literal(false),
		reason: z.enum(["no-api-key", "invalid-api-key"]),
	}),
]);
export type ScoreResponse = z.infer<typeof ScoreResponse>;
