import { z } from "zod";

/** User overrides that apply without asking the model. */
export const SiteRule = z.enum(["boost", "hide"]);
export type SiteRule = z.infer<typeof SiteRule>;

/** A lowercase hostname without "www.". Only obtainable through siteDomainOf. */
export const SiteDomain = z
	.string()
	.regex(/^(?!www\.)[a-z0-9-]+(\.[a-z0-9-]+)+$/)
	.brand<"SiteDomain">();
export type SiteDomain = z.infer<typeof SiteDomain>;

export const SiteRules = z.record(SiteDomain, SiteRule);
export type SiteRules = z.infer<typeof SiteRules>;

export function siteDomainOf(url: string): SiteDomain | null {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return null;
	}
	const parsed = SiteDomain.safeParse(
		hostname.toLowerCase().replace(/^www\./, ""),
	);
	return parsed.success ? parsed.data : null;
}

/** A rule for example.com also covers blog.example.com. The most specific rule wins. */
export function ruleFor(rules: SiteRules, domain: SiteDomain): SiteRule | null {
	const labels = domain.split(".");
	for (let i = 0; i < labels.length - 1; i++) {
		const rule = rules[labels.slice(i).join(".") as SiteDomain];
		if (rule) return rule;
	}
	return null;
}

const RULES_KEY = "siteRules";

export function parseStoredRules(raw: unknown): SiteRules {
	// Drop only the bad entries so one malformed rule can't erase the rest.
	if (typeof raw !== "object" || raw === null) return {};
	const out: SiteRules = {};
	for (const [domain, rule] of Object.entries(raw)) {
		const d = SiteDomain.safeParse(domain);
		const r = SiteRule.safeParse(rule);
		if (d.success && r.success) out[d.data] = r.data;
	}
	return out;
}

export async function loadSiteRules(): Promise<SiteRules> {
	const stored = await chrome.storage.sync.get(RULES_KEY);
	return parseStoredRules(stored[RULES_KEY]);
}

export async function setSiteRule(
	domain: SiteDomain,
	rule: SiteRule | null,
): Promise<void> {
	const rules = await loadSiteRules();
	if (rule) rules[domain] = rule;
	else delete rules[domain];
	await chrome.storage.sync.set({ [RULES_KEY]: rules });
}

export function isRulesChange(changes: {
	[key: string]: chrome.storage.StorageChange;
}): boolean {
	return RULES_KEY in changes;
}
