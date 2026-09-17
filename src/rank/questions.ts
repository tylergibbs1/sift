import { z } from "zod";
import type { Answers, Questions } from "../jev/schema";
import { Unit } from "../jev/schema";

/**
 * One atomic question per factor. Weighting happens in code (see plan.ts),
 * so changing priorities never means rewriting a prompt.
 */
export const QUESTIONS = {
	answers_query: {
		type: "noul",
		instructions:
			"Does this search result directly address what the query asks for?",
		criteria: {
			true: "Addresses the specific need expressed in the query",
			false: "Adjacent topic, generic, or only keyword-matched",
		},
	},
	is_promotional: {
		type: "noul",
		instructions: "Is this result primarily selling a product or service?",
		criteria: {
			true: "Vendor page, landing page, or sales copy",
			false: "Informational content",
		},
	},
	is_seo_filler: {
		type: "noul",
		instructions:
			"Is this thin content written to rank in search rather than to inform?",
		criteria: {
			true: "Listicle, content farm, affiliate roundup, or keyword padding",
			false: "Substantive content",
		},
	},
	is_discussion: {
		type: "noul",
		instructions:
			"Is this a discussion among real people, such as a forum thread or Q&A?",
		criteria: {
			true: "Forum, community Q&A, or comment thread",
			false: "Article, product page, or other single-author content",
		},
	},
	depth: {
		type: "score",
		instructions: "How substantive is this source likely to be?",
		criteria: [
			"Ad or product page",
			"Thin generic article",
			"Solid overview",
			"Primary source, official docs, or expert detail",
		],
	},
} as const satisfies Questions;

export type SerpAnswers = Answers<typeof QUESTIONS>;

/**
 * Asked once per search. Deliberately narrow: "best vpn" is research, not
 * a purchase, so it should still filter sales pages. "buy running shoes" is.
 */
export const INTENT_QUESTIONS = {
	wants_to_buy: {
		type: "noul",
		instructions:
			"Is this search transactional: the person wants to buy, order, or book something now, or find its price or where to get it?",
		criteria: {
			true: "Ready to purchase: buy, order, book, price, deal, store, or delivery near me",
			false:
				"Researching, comparing options, reading reviews, or seeking information or instructions",
		},
	},
} as const satisfies Questions;

/** At or above this, sales pages are what the person wants, so they aren't penalized. */
export const SHOPPING_INTENT_THRESHOLD = 0.7;

/** What the rest of the extension knows about one result. Crosses the message boundary, so it's a schema. */
export const ResultScores = z.object({
	answersQuery: Unit,
	promotional: Unit,
	seoFiller: Unit,
	discussion: Unit,
	depth: Unit,
	/** How sure the model is about what kind of page this is. Gates hiding. */
	pageTypeConfidence: Unit,
});
export type ResultScores = z.infer<typeof ResultScores>;

export function toResultScores(a: SerpAnswers): ResultScores {
	return {
		answersQuery: a.answers_query.noul,
		promotional: a.is_promotional.noul,
		seoFiller: a.is_seo_filler.noul,
		discussion: a.is_discussion.noul,
		depth: a.depth.normalized,
		pageTypeConfidence: a.depth.confidence,
	};
}
