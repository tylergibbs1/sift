import type { Planned } from "../rank/plan";
import type { SiteDomain, SiteRule } from "../rules";
import { type Motion, SURFACE_SPRING } from "./motion";
import type { ScrapedResult } from "./scrape";

export type ExplainRow = {
	readonly label: string;
	readonly value: number;
	/** "raises" pushes a result up as it grows; "lowers" pushes it down. */
	readonly effect: "raises" | "lowers" | "none";
	readonly note?: string;
};

export type Explanation = {
	readonly headline: string;
	readonly detail: string | null;
	readonly rows: readonly ExplainRow[];
};

/** Pure: what the popover says about one result. */
export function explain(
	p: Planned<ScrapedResult>,
	context: { readonly shopping: boolean; readonly discussionWeight: number },
): Explanation {
	const rule =
		p.rule === "boost"
			? "You chose to always boost this site."
			: p.rule === "hide"
				? "You chose to always hide this site."
				: null;

	if (!p.scores) {
		return {
			headline: rule ? "Your rule" : "Not scored",
			detail:
				rule ??
				"Sift couldn't score this result, so it stays where Google put it.",
			rows: [],
		};
	}

	const s = p.scores;
	const rows: ExplainRow[] = [
		{ label: "Answers the question", value: s.answersQuery, effect: "raises" },
		{ label: "Depth", value: s.depth, effect: "raises" },
		{
			label: "Selling something",
			value: s.promotional,
			effect: context.shopping ? "none" : "lowers",
			...(context.shopping && { note: "Not a penalty on a shopping search" }),
		},
		{ label: "SEO filler", value: s.seoFiller, effect: "lowers" },
		{
			label: "Forum or Q&A",
			value: s.discussion,
			effect: context.discussionWeight > 0 ? "raises" : "none",
		},
	];
	const score = p.composite === null ? "" : ` ${Math.round(p.composite * 100)}`;
	const confidence = `Sift is ${Math.round(s.pageTypeConfidence * 100)}% sure what kind of page this is.`;
	return {
		headline: rule ? "Your rule" : `Rank score${score}`,
		detail: rule ? `${rule} ${confidence}` : confidence,
		rows,
	};
}

const CSS = `
:host { all: initial; }
.pop {
  position: fixed; inset: auto; margin: 0; box-sizing: border-box;
  width: min(320px, calc(100vw - 32px)); padding: 16px; overflow: auto; overscroll-behavior: contain;
  border: 1px solid rgb(0 0 0 / 0.06); border-radius: 16px;
  font: 13px/1.4 system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  color: #1d1d1f; background: rgb(255 255 255 / 0.8);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.6), 0 2px 6px rgb(0 0 0 / 0.06), 0 16px 40px rgb(0 0 0 / 0.16);
}
.site { margin: 0 0 2px; font-size: 12px; font-weight: 500; color: rgb(60 60 67 / 0.6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pop:focus { outline: none; }
h2 { margin: 0; font-size: 17px; line-height: 1.2; font-weight: 600; letter-spacing: -0.02em; }
.detail { margin: 4px 0 0; color: rgb(60 60 67 / 0.72); }
ul { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 10px; }
.row { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: baseline; }
.value { font-variant-numeric: tabular-nums; color: rgb(60 60 67 / 0.72); }
.track { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: rgb(120 120 128 / 0.16); overflow: hidden; }
.fill { height: 100%; border-radius: 2px; background: #8e8e93; }
.row[data-effect=raises] .fill { background: #007aff; }
.row[data-effect=lowers] .fill { background: #ff9500; }
.note { grid-column: 1 / -1; font-size: 12px; color: rgb(60 60 67 / 0.6); }
.actions { display: flex; gap: 8px; margin-top: 16px; }
button {
  flex: 1; height: 32px; padding: 0 10px; border: 0; border-radius: 999px; cursor: pointer;
  font: 500 13px/1 system-ui, -apple-system, sans-serif;
  color: #007aff; background: rgb(0 122 255 / 0.12);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: transform 100ms ease-out, background-color 150ms ease-out;
}
button:hover { background: rgb(0 122 255 / 0.18); }
button:active { transform: scale(0.96); }
button:focus-visible { outline: 2px solid #007aff; outline-offset: 2px; }
button[data-rule=hide] { color: #d70015; background: rgb(255 59 48 / 0.1); }
button[data-rule=hide]:hover { background: rgb(255 59 48 / 0.16); }
@media (prefers-color-scheme: dark) {
  .pop {
    color: #f5f5f7; background: rgb(44 44 46 / 0.8); border-color: rgb(255 255 255 / 0.1);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08), 0 2px 6px rgb(0 0 0 / 0.3), 0 16px 40px rgb(0 0 0 / 0.5);
  }
  .detail, .value { color: rgb(235 235 245 / 0.7); }
  .site { color: rgb(235 235 245 / 0.55); }
  .note { color: rgb(235 235 245 / 0.55); }
  .track { background: rgb(118 118 128 / 0.32); }
  .row[data-effect=raises] .fill { background: #0a84ff; }
  .row[data-effect=lowers] .fill { background: #ff9f0a; }
  button { color: #0a84ff; background: rgb(10 132 255 / 0.2); }
  button:hover { background: rgb(10 132 255 / 0.28); }
  button[data-rule=hide] { color: #ff6961; background: rgb(255 69 58 / 0.18); }
  button[data-rule=hide]:hover { background: rgb(255 69 58 / 0.26); }
}
@media (prefers-reduced-transparency: reduce) {
  .pop { background: #ffffff; backdrop-filter: none; -webkit-backdrop-filter: none; }
}
@media (prefers-reduced-transparency: reduce) and (prefers-color-scheme: dark) {
  .pop { background: #2c2c2e; }
}
@media (prefers-contrast: more) {
  .pop { background: Canvas; color: CanvasText; border: 1px solid CanvasText; backdrop-filter: none; }
  .detail, .value, .note, .site { color: CanvasText; }
  button { outline: 1px solid currentColor; }
}
@media (prefers-reduced-motion: reduce) {
  button { transition: none; }
}
`;

export type Explainer = {
	open(
		p: Planned<ScrapedResult>,
		anchor: HTMLElement,
		context: { shopping: boolean; discussionWeight: number },
	): void;
};

/**
 * One shared popover. It grows out of the badge that opened it, and uses the
 * Popover API so Escape and clicking elsewhere close it natively.
 */
export function createExplainer(
	doc: Document,
	motion: Motion,
	onRule: (domain: SiteDomain, rule: SiteRule | null) => void,
): Explainer {
	const host = doc.createElement("sift-explainer");
	const shadow = host.attachShadow({ mode: "open" });
	const style = doc.createElement("style");
	style.textContent = CSS;
	const pop = doc.createElement("div");
	pop.className = "pop";
	pop.popover = "auto";
	pop.setAttribute("role", "dialog");
	pop.setAttribute("aria-label", "Why this rank");
	pop.tabIndex = -1;
	shadow.append(style, pop);
	doc.body.append(host);

	let anchor: HTMLElement | null = null;
	const release = (restoreFocus: boolean) => {
		anchor?.setAttribute("aria-expanded", "false");
		if (restoreFocus) anchor?.focus({ preventScroll: true });
		anchor = null;
	};
	// Toggle events are async, so ignore one that arrives after a re-open.
	pop.addEventListener("toggle", () => {
		if (pop.matches(":popover-open")) return;
		// Hand focus back only if it was inside the popover, not if the user clicked elsewhere.
		const focusWasInside =
			doc.activeElement === host || doc.activeElement === doc.body;
		release(focusWasInside);
	});

	return {
		open(p, trigger, context) {
			if (pop.matches(":popover-open")) {
				release(false);
				pop.hidePopover();
			}
			anchor = trigger;
			render(doc, pop, p, context, (rule) => {
				pop.hidePopover();
				onRule(p.item.result.domain, rule);
			});
			pop.showPopover();
			trigger.setAttribute("aria-expanded", "true");
			const origin = place(pop, trigger);
			if (motion !== "instant") grow(pop, origin, motion);
			// Focus the surface, not a button, so a mouse open shows no focus ring.
			pop.focus({ preventScroll: true });
		},
	};
}

function render(
	doc: Document,
	pop: HTMLElement,
	p: Planned<ScrapedResult>,
	context: { shopping: boolean; discussionWeight: number },
	setRule: (rule: SiteRule | null) => void,
): void {
	const e = explain(p, context);
	const el = <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		className: string | null,
		text: string | null,
	) => {
		const node = doc.createElement(tag);
		if (className) node.className = className;
		if (text !== null) node.textContent = text;
		return node;
	};

	const domain = p.item.result.domain;
	const children: HTMLElement[] = [
		el("p", "site", domain),
		el("h2", null, e.headline),
	];
	if (e.detail) children.push(el("p", "detail", e.detail));
	if (e.rows.length > 0) {
		const list = el("ul", null, null);
		for (const row of e.rows) {
			const li = el("li", "row", null);
			li.dataset.effect = row.effect;
			const track = el("div", "track", null);
			const fill = el("div", "fill", null);
			fill.style.width = `${Math.round(row.value * 100)}%`;
			track.append(fill);
			li.append(
				el("span", null, row.label),
				el("span", "value", `${Math.round(row.value * 100)}%`),
				track,
			);
			if (row.note) li.append(el("span", "note", row.note));
			list.append(li);
		}
		children.push(list);
	}

	const actions = el("div", "actions", null);
	const action = (label: string, rule: SiteRule | null) => {
		const button = el("button", null, label);
		button.type = "button";
		button.setAttribute("aria-label", `${label}: ${domain}`);
		if (rule) button.dataset.rule = rule;
		button.addEventListener("click", () => setRule(rule));
		actions.append(button);
	};
	if (p.rule) {
		action(p.rule === "boost" ? "Stop boosting" : "Stop hiding", null);
	} else {
		action("Always boost", "boost");
		action("Always hide", "hide");
	}
	children.push(actions);
	pop.replaceChildren(...children);
}

/**
 * Below the trigger if it fits, else above, else whichever side has more
 * room with the popover scrolling. It never covers its own trigger.
 * Returns the transform origin so the popover grows out of the trigger.
 */
function place(pop: HTMLElement, trigger: HTMLElement): string {
	const win = pop.ownerDocument.defaultView;
	if (!win) return "top left";
	const gutter = 16;
	const gap = 8;
	pop.style.maxHeight = "";
	const a = trigger.getBoundingClientRect();
	const { width, height } = pop.getBoundingClientRect();
	const roomBelow = win.innerHeight - gutter - (a.bottom + gap);
	const roomAbove = a.top - gap - gutter;
	const below =
		height <= roomBelow || (height > roomAbove && roomBelow >= roomAbove);
	const fitted = Math.min(height, below ? roomBelow : roomAbove);
	if (fitted < height) pop.style.maxHeight = `${fitted}px`;

	const left = Math.min(
		Math.max(a.left, gutter),
		win.innerWidth - width - gutter,
	);
	pop.style.left = `${left}px`;
	pop.style.top = `${below ? a.bottom + gap : a.top - gap - fitted}px`;
	const x = Math.min(Math.max(a.left + a.width / 2 - left, 0), width);
	return `${x}px ${below ? "0" : "100%"}`;
}

function grow(pop: HTMLElement, origin: string, motion: Motion): void {
	for (const a of pop.getAnimations()) a.cancel();
	if (motion === "reduced") {
		pop.animate([{ opacity: 0 }, { opacity: 1 }], {
			duration: 150,
			easing: "ease-out",
		});
		return;
	}
	pop.style.transformOrigin = origin;
	pop.animate(
		[
			{ transform: "scale(0.9)", opacity: 0, filter: "blur(4px)" },
			{ transform: "scale(1)", opacity: 1, filter: "blur(0)" },
		],
		{ duration: SURFACE_SPRING.duration, easing: SURFACE_SPRING.easing },
	);
}
