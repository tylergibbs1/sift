import type { SiteRule } from "../rules";
import type { Settings, Weights } from "../settings";
import type { ResultScores } from "./questions";

export type Verdict =
	| { readonly kind: "keep" }
	| { readonly kind: "boost"; readonly reason: string }
	| { readonly kind: "dim"; readonly reason: string }
	| { readonly kind: "hide"; readonly reason: string };

export type Planned<T> = {
	readonly item: T;
	/** null when scoring failed or was skipped because a site rule applies. */
	readonly scores: ResultScores | null;
	readonly composite: number | null;
	readonly rule: SiteRule | null;
	readonly verdict: Verdict;
};

export type PagePlan<T> = {
	/** Display order for results that stay on the page. */
	readonly visible: readonly Planned<T>[];
	readonly hidden: readonly Planned<T>[];
	/** The search looks transactional, so sales pages were not penalized. */
	readonly shopping: boolean;
};

export type PlanInputs<T> = {
	readonly scoresFor: (item: T) => ResultScores | null;
	readonly ruleFor: (item: T) => SiteRule | null;
	readonly shopping: boolean;
};

/** Weighted mean in [0, 1]. All-zero weights score everything equally. */
export function composite(s: ResultScores, w: Weights): number {
	const terms: [number, number][] = [
		[w.answersQuery, s.answersQuery],
		[w.depth, s.depth],
		[w.notPromotional, 1 - s.promotional],
		[w.notSeoFiller, 1 - s.seoFiller],
		[w.discussion, s.discussion],
	];
	const total = terms.reduce((sum, [weight]) => sum + weight, 0);
	if (total === 0) return 0;
	return terms.reduce((sum, [weight, v]) => sum + weight * v, 0) / total;
}

export function verdict(s: ResultScores, settings: Settings): Verdict {
	const reasons: string[] = [];
	if (settings.hidePromotional && s.promotional >= settings.flagThreshold) {
		reasons.push(`promotional ${pct(s.promotional)}`);
	}
	if (settings.hideSeoFiller && s.seoFiller >= settings.flagThreshold) {
		reasons.push(`SEO filler ${pct(s.seoFiller)}`);
	}
	if (reasons.length === 0) return { kind: "keep" };
	const reason = reasons.join(", ");
	// Low confidence means reorder and dim, never hide.
	return s.pageTypeConfidence >= settings.hideMinConfidence
		? { kind: "hide", reason }
		: { kind: "dim", reason: `${reason} (low confidence)` };
}

/** On a shopping search, selling something is the point, so it isn't a penalty. */
export function settingsForSearch(
	settings: Settings,
	shopping: boolean,
): Settings {
	if (!shopping) return settings;
	return {
		...settings,
		hidePromotional: false,
		weights: { ...settings.weights, notPromotional: 0 },
	};
}

/**
 * Boosted sites go first, in their original order. The rest are sorted by
 * composite, highest first; unscored items keep their original slots so a
 * partial API failure never scrambles the page.
 */
export function planPage<T>(
	items: readonly T[],
	inputs: PlanInputs<T>,
	baseSettings: Settings,
): PagePlan<T> {
	const settings = settingsForSearch(baseSettings, inputs.shopping);
	const planned: Planned<T>[] = items.map((item) => {
		const rule = inputs.ruleFor(item);
		const scores = inputs.scoresFor(item);
		const score = scores ? composite(scores, settings.weights) : null;
		return { item, scores, composite: score, rule, verdict: pick() };

		function pick(): Verdict {
			if (rule === "boost") return { kind: "boost", reason: "Boosted by you" };
			if (rule === "hide") return { kind: "hide", reason: "Hidden by you" };
			return scores ? verdict(scores, settings) : { kind: "keep" };
		}
	});

	const boosted = planned.filter((p) => p.rule === "boost");
	const rest = planned.filter((p) => p.rule !== "boost");
	const isRanked = (p: Planned<T>) => p.rule === null && p.composite !== null;
	const ranked = rest
		.filter(isRanked)
		.sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0));
	let next = 0;
	const ordered = [
		...boosted,
		...rest.map((p) => (isRanked(p) ? (ranked[next++] ?? p) : p)),
	];

	return {
		visible: ordered.filter((p) => p.verdict.kind !== "hide"),
		hidden: ordered.filter((p) => p.verdict.kind === "hide"),
		shopping: inputs.shopping,
	};
}

function pct(v: number): string {
	return `${Math.round(v * 100)}%`;
}

export type PageChanges = {
	/** Visible results that no longer sit at their original position among visible results. */
	readonly moved: number;
	readonly hidden: number;
	readonly dimmed: number;
	readonly boosted: number;
	readonly shopping: boolean;
};

export function summarizeChanges<T>(
	original: readonly T[],
	plan: PagePlan<T>,
): PageChanges {
	const hiddenItems = new Set(plan.hidden.map((p) => p.item));
	const originalVisible = original.filter((item) => !hiddenItems.has(item));
	const count = (kind: Verdict["kind"]) =>
		plan.visible.filter((p) => p.verdict.kind === kind).length;
	return {
		moved: plan.visible.filter((p, i) => originalVisible[i] !== p.item).length,
		hidden: plan.hidden.length,
		dimmed: count("dim"),
		boosted: count("boost"),
		shopping: plan.shopping,
	};
}

export function hasChanges(c: PageChanges): boolean {
	return c.moved + c.hidden + c.dimmed + c.boosted > 0;
}
