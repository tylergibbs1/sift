import {
	isRulesChange,
	loadSiteRules,
	type SiteRules,
	setSiteRule,
} from "./rules";
import {
	loadApiKey,
	loadSettings,
	Settings,
	saveApiKey,
	saveSettings,
	type Weights,
} from "./settings";

const WEIGHT_KEYS = [
	"answersQuery",
	"depth",
	"notPromotional",
	"notSeoFiller",
	"discussion",
] as const satisfies readonly (keyof Weights)[];

const SWITCHES = [
	"enabled",
	"showSummary",
	"hidePromotional",
	"hideSeoFiller",
] as const satisfies readonly (keyof Settings)[];

const THRESHOLDS = [
	"flagThreshold",
	"hideMinConfidence",
] as const satisfies readonly (keyof Settings)[];

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
	const el = document.getElementById(id);
	if (!(el instanceof type)) {
		throw new Error(`options.html is missing #${id} (${type.name})`);
	}
	return el;
}

const input = (id: string) => byId(id, HTMLInputElement);
const numberInputs = [...THRESHOLDS, ...WEIGHT_KEYS.map((k) => `w-${k}`)];

async function populate(): Promise<void> {
	const [settings, apiKey] = await Promise.all([loadSettings(), loadApiKey()]);
	input("apiKey").value = apiKey ?? "";
	for (const key of SWITCHES) input(key).checked = settings[key];
	for (const key of THRESHOLDS) input(key).valueAsNumber = settings[key];
	for (const key of WEIGHT_KEYS) {
		input(`w-${key}`).valueAsNumber = settings.weights[key];
	}
}

/** Saves on every change, like a settings app. Invalid fields are marked in place. */
async function saveFromForm(): Promise<void> {
	const parsed = Settings.safeParse({
		...Object.fromEntries(SWITCHES.map((k) => [k, input(k).checked])),
		...Object.fromEntries(THRESHOLDS.map((k) => [k, input(k).valueAsNumber])),
		weights: Object.fromEntries(
			WEIGHT_KEYS.map((k) => [k, input(`w-${k}`).valueAsNumber]),
		),
	});

	for (const id of numberInputs) input(id).removeAttribute("aria-invalid");
	byId("thresholdError", HTMLElement).textContent = "";
	byId("weightError", HTMLElement).textContent = "";
	if (parsed.success) {
		await saveSettings(parsed.data);
		flash("Saved");
		return;
	}

	for (const issue of parsed.error.issues) {
		const [first, second] = issue.path;
		const isWeight = first === "weights";
		const id = isWeight ? `w-${String(second)}` : String(first);
		input(id).setAttribute("aria-invalid", "true");
		byId(isWeight ? "weightError" : "thresholdError", HTMLElement).textContent =
			"Enter a number from 0 to 1.";
	}
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;
function flash(message: string): void {
	const toast = byId("toast", HTMLElement);
	toast.textContent = message;
	toast.classList.add("shown");
	clearTimeout(flashTimer);
	flashTimer = setTimeout(() => toast.classList.remove("shown"), 1400);
}

for (const id of [...SWITCHES, ...numberInputs]) {
	input(id).addEventListener("change", () => void saveFromForm());
}
input("apiKey").addEventListener("change", async (event) => {
	const field = event.currentTarget as HTMLInputElement;
	await saveApiKey(field.value);
	flash(field.value.trim() ? "API key saved" : "API key removed");
});

function renderRules(rules: SiteRules): void {
	const group = byId("rules", HTMLElement);
	const entries = Object.entries(rules).sort(([a], [b]) => a.localeCompare(b));
	if (entries.length === 0) {
		const row = document.createElement("div");
		row.className = "row empty";
		row.textContent = "No rules yet";
		group.replaceChildren(row);
		return;
	}
	group.replaceChildren(
		...entries.map(([domain, rule]) => {
			const row = document.createElement("div");
			row.className = "row";
			const name = document.createElement("span");
			name.className = "domain";
			name.textContent = domain;
			const kind = document.createElement("span");
			kind.className = "rule-kind";
			kind.textContent = rule === "boost" ? "Boosted" : "Hidden";
			const remove = document.createElement("button");
			remove.type = "button";
			remove.className = "remove";
			remove.textContent = "Remove";
			remove.setAttribute("aria-label", `Remove rule for ${domain}`);
			remove.addEventListener("click", () => {
				void setSiteRule(domain as keyof SiteRules, null).then(() =>
					flash(`Removed ${domain}`),
				);
			});
			row.append(name, kind, remove);
			return row;
		}),
	);
}

chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "sync" && isRulesChange(changes)) {
		void loadSiteRules().then(renderRules);
	}
});

void populate();
void loadSiteRules().then(renderRules);
