import { createJevClient, JEV_ENDPOINT, JevError } from "../src/jev/client";
import { QUESTIONS } from "../src/rank/questions";
import { jevResponse, jsonResponse } from "./helpers";

function setup(responses: Array<Response | Error>) {
	const calls: { url: string; init: RequestInit }[] = [];
	const sleeps: number[] = [];
	const client = createJevClient({
		apiKey: "sk-test",
		fetch: async (url, init) => {
			calls.push({ url: String(url), init: init ?? {} });
			const next = responses.shift();
			if (!next) throw new Error("unexpected extra request");
			if (next instanceof Error) throw next;
			return next;
		},
		sleep: async (ms) => {
			sleeps.push(ms);
		},
		random: () => 1,
		baseDelayMs: 100,
	});
	return { client, calls, sleeps };
}

describe("Jev client", () => {
	it("posts state and questions with bearer auth", async () => {
		const { client, calls } = setup([jsonResponse(jevResponse())]);
		await client.evaluate({ query: "q" }, QUESTIONS);

		expect(calls).toHaveLength(1);
		const call = calls[0];
		expect(call?.url).toBe(JEV_ENDPOINT);
		expect(new Headers(call?.init.headers).get("Authorization")).toBe(
			"Bearer sk-test",
		);
		expect(JSON.parse(String(call?.init.body))).toEqual({
			state: { query: "q" },
			model: "jev-latest",
			questions: QUESTIONS,
		});
	});

	it("normalizes score answers by the rubric length", async () => {
		const { client } = setup([
			jsonResponse(jevResponse({ depth: 1.5, depthConfidence: 0.7 })),
		]);
		const answers = await client.evaluate("s", QUESTIONS);
		expect(answers.depth).toEqual({
			score: 1.5,
			normalized: 0.5,
			confidence: 0.7,
		});
		expect(answers.answers_query.noul).toBe(0.8);
	});

	it("retries 429 and 529 with exponential backoff", async () => {
		const { client, sleeps } = setup([
			jsonResponse({}, 429),
			jsonResponse({}, 529),
			jsonResponse(jevResponse()),
		]);
		await client.evaluate("s", QUESTIONS);
		expect(sleeps).toEqual([100, 200]);
	});

	it("gives up after max attempts", async () => {
		const { client, calls } = setup(
			Array.from({ length: 4 }, () => jsonResponse({}, 429)),
		);
		await expect(client.evaluate("s", QUESTIONS)).rejects.toMatchObject({
			status: 429,
		});
		expect(calls).toHaveLength(4);
	});

	it("does not retry non-retryable errors", async () => {
		const { client, calls } = setup([jsonResponse({ detail: "bad" }, 401)]);
		const error = await client
			.evaluate("s", QUESTIONS)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(JevError);
		expect((error as JevError).isAuthFailure).toBe(true);
		expect(calls).toHaveLength(1);
	});

	it("wraps network failures", async () => {
		const { client } = setup([new TypeError("offline")]);
		await expect(client.evaluate("s", QUESTIONS)).rejects.toMatchObject({
			status: null,
		});
	});

	it("rejects out-of-range answers", async () => {
		const bad = jevResponse({ is_promotional: 1.4 });
		const { client } = setup([jsonResponse(bad)]);
		await expect(client.evaluate("s", QUESTIONS)).rejects.toThrow(
			/is_promotional/,
		);
	});

	it("rejects a response missing an answer", async () => {
		const body = jevResponse();
		const { depth: _omitted, ...rest } = body.answers;
		const { client } = setup([jsonResponse({ ...body, answers: rest })]);
		await expect(client.evaluate("s", QUESTIONS)).rejects.toThrow(/depth/);
	});

	it("rejects a score above the rubric's top level", async () => {
		const { client } = setup([jsonResponse(jevResponse({ depth: 4 }))]);
		await expect(client.evaluate("s", QUESTIONS)).rejects.toThrow(/depth/);
	});
});
