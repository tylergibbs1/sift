import { z } from "zod";

/** A number in [0, 1]. Only obtainable by parsing, so every Unit in the code is known-valid. */
export const Unit = z.number().min(0).max(1).brand<"Unit">();
export type Unit = z.infer<typeof Unit>;

export type NoulQuestion = {
	readonly type: "noul";
	readonly instructions: string;
	readonly criteria?: { readonly true: string; readonly false: string };
};

export type ScoreQuestion = {
	readonly type: "score";
	readonly instructions: string;
	/** Ordered lowest to highest. The API requires at least two levels. */
	readonly criteria: readonly [string, string, ...string[]];
};

export type Question = NoulQuestion | ScoreQuestion;
export type Questions = Readonly<Record<string, Question>>;

export type NoulAnswer = { readonly noul: Unit };

export type ScoreAnswer = {
	/** Raw level, in [0, levels - 1]. */
	readonly score: number;
	/** score / (levels - 1), so callers never hardcode the rubric length. */
	readonly normalized: Unit;
	readonly confidence: Unit;
};

export type AnswerFor<Q extends Question> = Q extends NoulQuestion
	? NoulAnswer
	: ScoreAnswer;

export type Answers<Q extends Questions> = {
	readonly [K in keyof Q]: AnswerFor<Q[K]>;
};

export const NoulAnswerWire = z.object({
	type: z.literal("noul"),
	noul: Unit,
});

export const ScoreAnswerWire = z.object({
	type: z.literal("score"),
	score: z.number().min(0),
	confidence: Unit,
});

export const ResponseWire = z.object({
	answers: z.record(z.string(), z.unknown()),
});
