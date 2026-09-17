import { z } from "zod";

const Weight = z.number().min(0).max(1);
const Threshold = z.number().min(0).max(1);

export const Weights = z.object({
	answersQuery: Weight.default(0.45),
	depth: Weight.default(0.3),
	notPromotional: Weight.default(0.15),
	notSeoFiller: Weight.default(0.1),
	discussion: Weight.default(0),
});
export type Weights = z.infer<typeof Weights>;

export const Settings = z.object({
	enabled: z.boolean().default(true),
	/** Corner note listing what changed, with a "Show original" toggle. */
	showSummary: z.boolean().default(true),
	hidePromotional: z.boolean().default(true),
	hideSeoFiller: z.boolean().default(true),
	/** A flag at or above this marks a result as promotional or filler. */
	flagThreshold: Threshold.default(0.85),
	/** Flagged results are hidden only when page-type confidence reaches this; otherwise dimmed. */
	hideMinConfidence: Threshold.default(0.6),
	weights: Weights.prefault({}),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = Settings.parse({});

const SETTINGS_KEY = "settings";
const API_KEY_KEY = "apiKey";

/**
 * Stored data is untrusted (older versions, manual edits), so anything that
 * fails validation falls back to defaults instead of breaking the page.
 */
export function parseStoredSettings(raw: unknown): Settings {
	const parsed = Settings.safeParse(raw ?? {});
	return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function isSettingsChange(changes: {
	[key: string]: chrome.storage.StorageChange;
}): boolean {
	return SETTINGS_KEY in changes;
}

export async function loadSettings(): Promise<Settings> {
	const stored = await chrome.storage.sync.get(SETTINGS_KEY);
	return parseStoredSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
	await chrome.storage.sync.set({ [SETTINGS_KEY]: Settings.parse(settings) });
}

// The API key lives in storage.local, which is never synced to the user's Google account.
export async function loadApiKey(): Promise<string | null> {
	const stored = await chrome.storage.local.get(API_KEY_KEY);
	const key = stored[API_KEY_KEY];
	return typeof key === "string" && key.trim() !== "" ? key.trim() : null;
}

export async function saveApiKey(key: string): Promise<void> {
	await chrome.storage.local.set({ [API_KEY_KEY]: key.trim() });
}
