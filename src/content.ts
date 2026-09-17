import type { Unit } from "./jev/schema";
import {
	type BackgroundRequest,
	ScoreResponse,
	type SerpResult,
} from "./messages";
import { hasChanges, planPage, summarizeChanges } from "./rank/plan";
import { type ResultScores, SHOPPING_INTENT_THRESHOLD } from "./rank/questions";
import {
	isRulesChange,
	loadSiteRules,
	ruleFor,
	type SiteRules,
	setSiteRule,
} from "./rules";
import { createExplainer } from "./serp/explain";
import { motionFor } from "./serp/motion";
import { type Applied, applyPlan, showNotice } from "./serp/render";
import { readQuery, type ScrapedResult, scrapeResults } from "./serp/scrape";
import { type ChangesToast, showChangesToast } from "./serp/toast";
import { isSettingsChange, loadSettings, type Settings } from "./settings";

const RAN_FLAG = "sift";

async function requestScores(
	query: string,
	results: SerpResult[],
	includeIntent: boolean,
): Promise<ScoreResponse | null> {
	const request: BackgroundRequest = {
		type: "score-results",
		query,
		results,
		includeIntent,
	};
	const parsed = ScoreResponse.safeParse(
		await chrome.runtime.sendMessage(request),
	);
	if (parsed.success) return parsed.data;
	console.warn("[sift] Unexpected response from background", parsed.error);
	return null;
}

function showKeyNotice(reason: "no-api-key" | "invalid-api-key"): void {
	const message =
		reason === "no-api-key"
			? "Sift needs a TypeSafe API key."
			: "Sift: the TypeSafe API key was rejected.";
	showNotice(document, message, {
		label: "Open settings",
		onClick: () => {
			const open: BackgroundRequest = { type: "open-options" };
			void chrome.runtime.sendMessage(open);
		},
	});
}

async function main(): Promise<void> {
	const root = document.documentElement;
	if (root.dataset[RAN_FLAG]) return;
	root.dataset[RAN_FLAG] = "1";

	let settings: Settings = await loadSettings();
	if (!settings.enabled) return;

	const query = readQuery(document);
	const scraped = scrapeResults(document);
	if (!query || scraped.length === 0) return;

	let rules: SiteRules = await loadSiteRules();
	const siteRule = (s: ScrapedResult) => ruleFor(rules, s.result.domain);
	const scores = new Map<string, ResultScores | null>();
	let shoppingIntent: Unit | null = null;

	/** Scores results that have no rule and no score yet. Rules never cost an API call. */
	const fetchMissing = async (includeIntent: boolean): Promise<boolean> => {
		const missing = scraped
			.filter((s) => !scores.has(s.result.id) && siteRule(s) === null)
			.map((s) => s.result);
		if (missing.length === 0 && !includeIntent) return true;
		const response = await requestScores(query, missing, includeIntent);
		if (!response) return false;
		if (!response.ok) {
			showKeyNotice(response.reason);
			return false;
		}
		for (const [id, s] of Object.entries(response.scores)) scores.set(id, s);
		if (includeIntent) shoppingIntent = response.shoppingIntent;
		return true;
	};

	if (!(await fetchMissing(true))) return;

	const motion = motionFor(window);
	const explainer = createExplainer(document, motion, (domain, rule) => {
		// The storage listener below re-ranks once the rule is saved.
		void setSiteRule(domain, rule);
	});
	let applied: Applied | null = null;
	let toast: ChangesToast | null = null;

	const rerank = () => {
		applied?.revert();
		const plan = planPage(
			scraped,
			{
				scoresFor: (s) => scores.get(s.result.id) ?? null,
				ruleFor: siteRule,
				shopping: (shoppingIntent ?? 0) >= SHOPPING_INTENT_THRESHOLD,
			},
			settings,
		);
		applied = applyPlan(document, plan, motion, (p, anchor) =>
			explainer.open(p, anchor, {
				shopping: plan.shopping,
				discussionWeight: settings.weights.discussion,
			}),
		);

		const changes = summarizeChanges(scraped, plan);
		if (!settings.showSummary || !hasChanges(changes)) {
			toast?.dismiss();
			toast = null;
		} else if (toast) {
			toast.update(changes);
		} else {
			toast = showChangesToast(
				document,
				changes,
				{
					showOriginal: () => {
						applied?.revert();
						applied = null;
					},
					reapply: rerank,
				},
				motion,
			);
		}
	};
	rerank();

	chrome.storage.onChanged.addListener(async (changes, area) => {
		if (area !== "sync") return;
		if (!isRulesChange(changes) && !isSettingsChange(changes)) return;
		[settings, rules] = await Promise.all([loadSettings(), loadSiteRules()]);
		if (!settings.enabled) {
			applied?.revert();
			applied = null;
			toast?.dismiss();
			toast = null;
			return;
		}
		// A removed rule leaves a result that was never scored.
		await fetchMissing(false);
		rerank();
	});
}

void main();
