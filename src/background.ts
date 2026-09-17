import { chromeLocalStore } from "./cache";
import { createJevClient } from "./jev/client";
import { BackgroundRequest } from "./messages";
import { type SiteRule, setSiteRule, siteDomainOf } from "./rules";
import { createSiftCaches, scoreResults } from "./scoring";
import { resultUrlFromHref } from "./serp/links";
import { loadApiKey } from "./settings";

const caches = createSiftCaches(chromeLocalStore());
const pruneCaches = () =>
	Promise.all([caches.scores.pruneExpired(), caches.intent.pruneExpired()]);

const MENU_ACTIONS = {
	"sift-boost": { title: "Always boost this site", rule: "boost" },
	"sift-hide": { title: "Always hide this site", rule: "hide" },
	"sift-clear": { title: "Remove rule for this site", rule: null },
} as const satisfies Record<string, { title: string; rule: SiteRule | null }>;

type MenuId = keyof typeof MENU_ACTIONS;
const isMenuId = (id: unknown): id is MenuId =>
	typeof id === "string" && id in MENU_ACTIONS;

function createMenus(): void {
	chrome.contextMenus.removeAll(() => {
		const documentUrlPatterns = ["https://www.google.com/search*"];
		chrome.contextMenus.create({
			id: "sift",
			title: "Sift",
			contexts: ["link"],
			documentUrlPatterns,
		});
		for (const [id, { title }] of Object.entries(MENU_ACTIONS)) {
			chrome.contextMenus.create({
				id,
				parentId: "sift",
				title,
				contexts: ["link"],
				documentUrlPatterns,
			});
		}
	});
}

chrome.runtime.onInstalled.addListener(async (details) => {
	createMenus();
	if (details.reason === "install" && !(await loadApiKey())) {
		await chrome.runtime.openOptionsPage();
	}
	await pruneCaches();
});

chrome.runtime.onStartup.addListener(() => {
	void pruneCaches();
});

chrome.contextMenus.onClicked.addListener((info) => {
	if (!isMenuId(info.menuItemId) || !info.linkUrl) return;
	const url = resultUrlFromHref(info.linkUrl);
	const domain = url && siteDomainOf(url.href);
	// The open tab re-ranks itself when it sees the storage change.
	if (domain) void setSiteRule(domain, MENU_ACTIONS[info.menuItemId].rule);
});

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
	// Only our own content scripts and pages may use the API key.
	if (sender.id !== chrome.runtime.id) return false;
	const parsed = BackgroundRequest.safeParse(raw);
	if (!parsed.success) return false;

	const request = parsed.data;
	switch (request.type) {
		case "open-options":
			void chrome.runtime.openOptionsPage();
			return false;
		case "score-results":
			void (async () => {
				const response = await scoreResults(request, {
					apiKey: await loadApiKey(),
					makeClient: (apiKey) => createJevClient({ apiKey }),
					caches,
					log: (message, error) => console.warn(`[sift] ${message}`, error),
				});
				sendResponse(response);
			})();
			return true;
	}
});
