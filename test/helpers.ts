import { Unit } from "../src/jev/schema";
import type { ResultScores } from "../src/rank/questions";
import { SiteDomain } from "../src/rules";

export const unit = (n: number): Unit => Unit.parse(n);

export function scores(
	overrides: Partial<Record<keyof ResultScores, number>> = {},
): ResultScores {
	const base = {
		answersQuery: 0.5,
		promotional: 0.1,
		seoFiller: 0.1,
		discussion: 0.1,
		depth: 0.5,
		pageTypeConfidence: 0.9,
		...overrides,
	};
	return Object.fromEntries(
		Object.entries(base).map(([k, v]) => [k, unit(v)]),
	) as ResultScores;
}

/** A wire-format Jev response for the SERP question set. */
export function jevResponse(
	o: {
		answers_query?: number;
		is_promotional?: number;
		is_seo_filler?: number;
		is_discussion?: number;
		depth?: number;
		depthConfidence?: number;
	} = {},
) {
	const noul = (v: number) => ({ type: "noul", noul: v });
	return {
		model: "jev-latest",
		answers: {
			answers_query: noul(o.answers_query ?? 0.8),
			is_promotional: noul(o.is_promotional ?? 0.1),
			is_seo_filler: noul(o.is_seo_filler ?? 0.1),
			is_discussion: noul(o.is_discussion ?? 0.2),
			depth: {
				type: "score",
				score: o.depth ?? 2,
				legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
				probabilities: { "0": 0.1, "1": 0.1, "2": 0.7, "3": 0.1 },
				confidence: o.depthConfidence ?? 0.8,
			},
		},
		usage: { input_tokens: 100, output_tokens: 10 },
	};
}

export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const domain = (d: string) => SiteDomain.parse(d);
