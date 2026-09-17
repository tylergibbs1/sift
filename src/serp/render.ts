import type { PagePlan, Planned } from "../rank/plan";
import { MOVE_SPRING, type Motion } from "./motion";
import type { ScrapedResult } from "./scrape";
import { SELECTORS } from "./selectors";

const CSS = `
.sift-dim { opacity: 0.45; transition: opacity 200ms ease-out; }
.sift-dim:hover, .sift-dim:focus-within { opacity: 1; }
.sift-badge, .sift-why {
  display: inline-flex; align-items: center; gap: 6px;
  margin: 0 0 6px; padding: 2px 9px 2px 7px; border: 0; border-radius: 999px;
  font: 500 12px/1.4 system-ui, -apple-system, sans-serif; letter-spacing: 0.01em;
  cursor: pointer; transition: transform 100ms ease-out, opacity 150ms ease-out;
}
.sift-badge { color: #9a3412; background: rgb(255 149 0 / 0.14); }
.sift-badge::before {
  content: ""; width: 6px; height: 6px; border-radius: 50%; background: #ff9500;
}
.sift-badge[data-kind=boost] { color: #0040dd; background: rgb(0 122 255 / 0.12); }
.sift-badge[data-kind=boost]::before { background: #007aff; }
.sift-badge:active, .sift-why:active { transform: scale(0.95); }
.sift-badge:focus-visible, .sift-why:focus-visible { outline: 2px solid #007aff; outline-offset: 2px; }
/* Quiet until you look at the result, so ten of them don't clutter the page */
.sift-why { color: #6e6e73; background: rgb(120 120 128 / 0.12); opacity: 0; }
.sift-scored:hover .sift-why, .sift-why:focus-visible, .sift-why[aria-expanded=true] { opacity: 1; }
.sift-hidden { margin: 20px 0 28px; }
.sift-hidden > summary {
  display: inline-flex; align-items: center; gap: 8px; list-style: none;
  padding: 6px 14px 6px 10px; border-radius: 999px; cursor: pointer; user-select: none;
  font: 500 14px/1.4 system-ui, -apple-system, sans-serif;
  color: #3c3c43; background: rgb(120 120 128 / 0.12);
  transition: transform 100ms ease-out, background-color 150ms ease-out;
}
.sift-hidden > summary::-webkit-details-marker { display: none; }
.sift-hidden > summary::before {
  content: ""; width: 7px; height: 7px; margin: 0 2px;
  border-right: 2px solid currentColor; border-bottom: 2px solid currentColor;
  transform: rotate(-45deg); transition: transform 250ms cubic-bezier(0.2, 0, 0, 1);
}
.sift-hidden[open] > summary::before { transform: rotate(45deg); }
.sift-hidden > summary:hover { background: rgb(120 120 128 / 0.18); }
.sift-hidden > summary:active { transform: scale(0.97); }
.sift-hidden > summary:focus-visible { outline: 2px solid #007aff; outline-offset: 2px; }
.sift-hidden[open] > summary { margin-bottom: 16px; }
.sift-notice {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 8px 0 20px; padding: 10px 14px; border-radius: 14px;
  font: 14px/1.4 system-ui, -apple-system, sans-serif;
  color: #1d1d1f; background: rgb(0 122 255 / 0.1);
}
.sift-notice button {
  font: 500 13px/1 system-ui, -apple-system, sans-serif; color: #fff;
  padding: 7px 12px; border: 0; border-radius: 999px; cursor: pointer;
  background: #007aff; transition: transform 100ms ease-out;
}
.sift-notice button:active { transform: scale(0.96); }
.sift-notice button:focus-visible { outline: 2px solid #007aff; outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  .sift-badge { color: #ffb340; background: rgb(255 159 10 / 0.18); }
  .sift-badge::before { background: #ff9f0a; }
  .sift-badge[data-kind=boost] { color: #64d2ff; background: rgb(10 132 255 / 0.2); }
  .sift-badge[data-kind=boost]::before { background: #0a84ff; }
  .sift-why { color: #aeaeb2; background: rgb(118 118 128 / 0.24); }
  .sift-hidden > summary { color: #ebebf5; background: rgb(118 118 128 / 0.24); }
  .sift-hidden > summary:hover { background: rgb(118 118 128 / 0.32); }
  .sift-notice { color: #f5f5f7; background: rgb(10 132 255 / 0.18); }
  .sift-notice button { background: #0a84ff; }
}
@media (prefers-contrast: more) {
  .sift-dim { opacity: 0.7; }
  .sift-badge, .sift-why, .sift-hidden > summary { outline: 1px solid currentColor; }
  .sift-why { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .sift-dim, .sift-badge, .sift-why, .sift-hidden > summary, .sift-hidden > summary::before, .sift-notice button { transition: none; }
}
`;

export type Applied = {
	/** Puts every block back where Google had it and removes all decorations. */
	revert(): void;
};

/**
 * Rearranges result blocks to match the plan. Each block's original position
 * becomes a slot marker, so blocks with different parents still land
 * correctly, and the same markers make the change reversible.
 */
export type Explain = (
	planned: Planned<ScrapedResult>,
	anchor: HTMLElement,
) => void;

export function applyPlan(
	doc: Document,
	plan: PagePlan<ScrapedResult>,
	motion: Motion,
	explain: Explain,
): Applied {
	injectStyles(doc);
	const originals = [...plan.visible, ...plan.hidden]
		.map((p) => p.item.block)
		.sort(byPageOrder);
	const slots = originals.map((block) => {
		const marker = doc.createComment("sift-slot");
		block.before(marker);
		return marker;
	});

	const added: Element[] = [];
	const classed: [Element, string][] = [];
	const addClass = (el: Element, name: string) => {
		el.classList.add(name);
		classed.push([el, name]);
	};
	const decorate = (p: Planned<ScrapedResult>) => {
		const { verdict, item } = p;
		if (verdict.kind === "keep" && !p.scores) return;
		if (verdict.kind === "dim") addClass(item.block, "sift-dim");

		const button = doc.createElement("button");
		button.type = "button";
		button.setAttribute("aria-haspopup", "dialog");
		button.setAttribute("aria-expanded", "false");
		if (verdict.kind === "keep") {
			addClass(item.block, "sift-scored");
			button.className = "sift-why";
			button.textContent = "Why here?";
		} else {
			button.className = "sift-badge";
			button.dataset.kind = verdict.kind;
			button.textContent = verdict.reason;
		}
		button.addEventListener("click", (event) => {
			event.preventDefault();
			explain(p, button);
		});
		item.block.prepend(button);
		added.push(button);
	};

	const visibleBlocks = plan.visible.map((p) => p.item.block);
	const glide = measureForGlide(visibleBlocks, motion);

	// Each slot receives exactly one block, placed directly after its marker.
	plan.visible.forEach((p, i) => {
		decorate(p);
		slots[i]?.after(p.item.block);
	});

	if (plan.hidden.length > 0) {
		const details = doc.createElement("details");
		details.className = "sift-hidden";
		const summary = doc.createElement("summary");
		const n = plan.hidden.length;
		summary.textContent = `Show ${n} hidden result${n === 1 ? "" : "s"}`;
		details.append(summary);
		for (const p of plan.hidden) {
			decorate(p);
			details.append(p.item.block);
		}
		slots[plan.visible.length]?.after(details);
		added.push(details);
	}
	glide();

	let reverted = false;
	return {
		revert() {
			if (reverted) return;
			reverted = true;
			const glideBack = measureForGlide(visibleBlocks, motion);
			originals.forEach((block, i) => {
				slots[i]?.after(block);
			});
			for (const el of added) el.remove();
			for (const [el, name] of classed) el.classList.remove(name);
			for (const marker of slots) marker.remove();
			glideBack();
		},
	};
}

export function showNotice(
	doc: Document,
	message: string,
	action: { label: string; onClick: () => void } | null,
): void {
	const root = doc.querySelector(SELECTORS.resultsRoot);
	if (!root) return;
	injectStyles(doc);
	const notice = doc.createElement("div");
	notice.className = "sift-notice";
	notice.textContent = `${message} `;
	if (action) {
		const button = doc.createElement("button");
		button.type = "button";
		button.textContent = action.label;
		button.addEventListener("click", action.onClick);
		notice.append(button);
	}
	root.before(notice);
}

/**
 * FLIP: records where blocks are now; the returned function, called after the
 * DOM moves, animates each block from its old position to its new one so the
 * reader can see what moved instead of the page jumping.
 */
function measureForGlide(
	blocks: readonly HTMLElement[],
	motion: Motion,
): () => void {
	// Reordering is spatial movement, so reduced motion places blocks directly.
	if (motion !== "full") return () => {};
	// Measured mid-flight, this is the on-screen position, so an interrupted glide starts where the eye is.
	const before = new Map(blocks.map((b) => [b, b.getBoundingClientRect().top]));
	return () => {
		for (const block of blocks) {
			for (const a of block.getAnimations()) a.cancel();
		}
		for (const block of blocks) {
			const from = before.get(block);
			if (from === undefined) continue;
			const dy = from - block.getBoundingClientRect().top;
			if (Math.abs(dy) < 1) continue;
			block.animate(
				[
					// Long travel reads better slightly translucent, then settles solid.
					{ transform: `translateY(${dy}px)`, opacity: 0.7 },
					{ transform: "translateY(0)", opacity: 1 },
				],
				{ duration: MOVE_SPRING.duration, easing: MOVE_SPRING.easing },
			);
		}
	};
}

function byPageOrder(a: Node, b: Node): number {
	return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
		? -1
		: 1;
}

function injectStyles(doc: Document): void {
	if (doc.getElementById("sift-styles")) return;
	const style = doc.createElement("style");
	style.id = "sift-styles";
	style.textContent = CSS;
	doc.head.append(style);
}
