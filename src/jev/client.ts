import { z } from "zod";
import {
	type Answers,
	NoulAnswerWire,
	type Question,
	type Questions,
	ResponseWire,
	ScoreAnswerWire,
	Unit,
} from "./schema";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

const RETRYABLE_STATUSES = new Set([429, 529]);

export class JevError extends Error {
	constructor(
		message: string,
		/** HTTP status, or null for network failures and malformed responses. */
		readonly status: number | null,
	) {
		super(message);
		this.name = "JevError";
	}

	get isAuthFailure(): boolean {
		return this.status === 401;
	}
}

export type JevClientOptions = {
	readonly apiKey: string;
	readonly fetch?: typeof fetch;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly random?: () => number;
	readonly maxAttempts?: number;
	readonly baseDelayMs?: number;
};

export type JevClient = {
	evaluate<Q extends Questions>(
		state: unknown,
		questions: Q,
	): Promise<Answers<Q>>;
};

export function createJevClient(options: JevClientOptions): JevClient {
	const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
	const sleep =
		options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	const random = options.random ?? Math.random;
	const maxAttempts = options.maxAttempts ?? 4;
	const baseDelayMs = options.baseDelayMs ?? 500;

	async function post(body: string): Promise<unknown> {
		for (let attempt = 1; ; attempt++) {
			const res = await doFetch(JEV_ENDPOINT, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${options.apiKey}`,
					"Content-Type": "application/json",
				},
				body,
			}).catch((cause: unknown) => {
				throw new JevError(`Network error: ${String(cause)}`, null);
			});

			if (res.ok) return res.json();

			if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxAttempts) {
				const detail = await res.text().catch(() => "");
				throw new JevError(
					`Jev request failed with ${res.status}: ${detail}`,
					res.status,
				);
			}
			// Full jitter keeps ten concurrent requests from retrying in lockstep.
			await sleep(random() * baseDelayMs * 2 ** (attempt - 1));
		}
	}

	return {
		async evaluate(state, questions) {
			const raw = await post(
				JSON.stringify({ state, model: JEV_MODEL, questions }),
			);
			return parseAnswers(raw, questions);
		},
	};
}

function parseAnswers<Q extends Questions>(
	raw: unknown,
	questions: Q,
): Answers<Q> {
	const response = ResponseWire.safeParse(raw);
	if (!response.success) {
		throw new JevError(
			`Malformed response: ${z.prettifyError(response.error)}`,
			null,
		);
	}
	const out: Record<string, unknown> = {};
	for (const [id, question] of Object.entries(questions)) {
		out[id] = parseAnswer(id, question, response.data.answers[id]);
	}
	return out as Answers<Q>;
}

function parseAnswer(id: string, question: Question, raw: unknown) {
	switch (question.type) {
		case "noul": {
			const parsed = NoulAnswerWire.safeParse(raw);
			if (!parsed.success) throw malformed(id, parsed.error);
			return { noul: parsed.data.noul };
		}
		case "score": {
			const parsed = ScoreAnswerWire.safeParse(raw);
			if (!parsed.success) throw malformed(id, parsed.error);
			const top = question.criteria.length - 1;
			const normalized = Unit.safeParse(parsed.data.score / top);
			if (!normalized.success) throw malformed(id, normalized.error);
			return {
				score: parsed.data.score,
				normalized: normalized.data,
				confidence: parsed.data.confidence,
			};
		}
	}
}

function malformed(id: string, error: z.ZodError): JevError {
	return new JevError(
		`Malformed answer for "${id}": ${z.prettifyError(error)}`,
		null,
	);
}
