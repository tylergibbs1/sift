import type { PageChanges } from "../rank/plan";
import { type Motion, SURFACE_SPRING } from "./motion";

/**
 * A floating, non-blocking material: translucent so the page stays present
 * behind it, no scrim because it never interrupts the search.
 * Rendered in a shadow root so Google's CSS can't restyle it.
 */
const CSS = `
:host { all: initial; }
.panel {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  display: flex; align-items: center; gap: 10px;
  max-width: calc(100vw - 32px); box-sizing: border-box;
  padding: 6px 6px 6px 16px; border-radius: 999px;
  font: 13px/1.3 system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  color: #1d1d1f;
  background: rgb(255 255 255 / 0.72);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgb(0 0 0 / 0.06);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.6),
    0 1px 2px rgb(0 0 0 / 0.06),
    0 8px 28px rgb(0 0 0 / 0.14);
}
.label { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.name { font-weight: 600; letter-spacing: -0.01em; }
.detail {
  font-weight: 500; letter-spacing: 0.005em; color: rgb(60 60 67 / 0.85);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
button {
  flex: none; font: 500 13px/1 system-ui, -apple-system, sans-serif;
  height: 30px; padding: 0 14px; border: 0; border-radius: 999px; cursor: pointer;
  color: #007aff; background: rgb(0 122 255 / 0.12);
  transition: transform 100ms ease-out, background-color 150ms ease-out;
}
button:hover { background: rgb(0 122 255 / 0.18); }
button:active { transform: scale(0.95); }
button:focus-visible { outline: 2px solid #007aff; outline-offset: 2px; }
.close {
  width: 30px; padding: 0; display: grid; place-items: center;
  color: rgb(60 60 67 / 0.6); background: rgb(120 120 128 / 0.12);
}
.close:hover { background: rgb(120 120 128 / 0.2); }
.close svg { width: 10px; height: 10px; }
@media (prefers-color-scheme: dark) {
  .panel {
    color: #f5f5f7;
    background: rgb(40 40 42 / 0.72);
    border-color: rgb(255 255 255 / 0.1);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.08),
      0 1px 2px rgb(0 0 0 / 0.3),
      0 8px 28px rgb(0 0 0 / 0.45);
  }
  .detail { color: rgb(235 235 245 / 0.75); }
  button { color: #0a84ff; background: rgb(10 132 255 / 0.2); }
  button:hover { background: rgb(10 132 255 / 0.28); }
  .close { color: rgb(235 235 245 / 0.6); background: rgb(118 118 128 / 0.24); }
  .close:hover { background: rgb(118 118 128 / 0.32); }
}
@media (prefers-reduced-transparency: reduce) {
  .panel { background: #ffffff; backdrop-filter: none; -webkit-backdrop-filter: none; }
}
@media (prefers-reduced-transparency: reduce) and (prefers-color-scheme: dark) {
  .panel { background: #2c2c2e; }
}
@media (prefers-contrast: more) {
  .panel { background: #ffffff; backdrop-filter: none; border: 1px solid #1d1d1f; }
  .detail { color: #1d1d1f; }
  button { outline: 1px solid currentColor; }
}
@media (prefers-contrast: more) and (prefers-color-scheme: dark) {
  .panel { background: #000000; border-color: #f5f5f7; }
  .detail { color: #f5f5f7; }
}
@media (prefers-reduced-motion: reduce) {
  button { transition: none; }
}
`;

const CLOSE_ICON =
	'<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

/** Where the panel rests offscreen. It arrives from, and leaves toward, the bottom edge. */
const OFFSTAGE: Keyframe = {
	transform: "translateY(16px) scale(0.96)",
	filter: "blur(6px)",
	opacity: 0,
};
const ONSTAGE: Keyframe = {
	transform: "translateY(0) scale(1)",
	filter: "blur(0)",
	opacity: 1,
};

export type ToastActions = {
	showOriginal(): void;
	reapply(): void;
};

export function describeChanges(c: PageChanges): string {
	const parts: string[] = [];
	if (c.moved > 0) parts.push(`reordered ${c.moved}`);
	if (c.boosted > 0) parts.push(`boosted ${c.boosted}`);
	if (c.hidden > 0) parts.push(`hid ${c.hidden}`);
	if (c.dimmed > 0) parts.push(`dimmed ${c.dimmed}`);
	if (c.shopping) parts.unshift("Shopping search");
	const text = parts.join(" · ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export type ChangesToast = {
	/** Shows the latest changes and returns to the re-ranked state. */
	update(changes: PageChanges): void;
	dismiss(): void;
};

/** A small corner status with an undo toggle. */
export function showChangesToast(
	doc: Document,
	initial: PageChanges,
	actions: ToastActions,
	motion: Motion,
): ChangesToast {
	const host = doc.createElement("sift-toast");
	const shadow = host.attachShadow({ mode: "open" });

	const style = doc.createElement("style");
	style.textContent = CSS;

	const panel = doc.createElement("div");
	panel.className = "panel";
	panel.setAttribute("role", "status");

	const label = doc.createElement("span");
	label.className = "label";
	const name = doc.createElement("span");
	name.className = "name";
	name.textContent = "Sift";
	const detail = doc.createElement("span");
	detail.className = "detail";
	label.append(name, detail);

	const toggle = doc.createElement("button");
	toggle.type = "button";

	let changes = initial;
	let showingOriginal = false;
	const render = () => {
		detail.textContent = showingOriginal
			? "Google's order"
			: describeChanges(changes);
		toggle.textContent = showingOriginal ? "Re-apply" : "Show original";
	};
	toggle.addEventListener("click", () => {
		showingOriginal = !showingOriginal;
		if (showingOriginal) actions.showOriginal();
		else actions.reapply();
		render();
	});

	let dismissed = false;
	const dismiss = () => {
		if (dismissed) return;
		dismissed = true;
		// Leave along the path it arrived on. A single keyframe animates from
		// the current on-screen value, so dismissing mid-entrance doesn't jump.
		const exit = animatePanel(panel, [OFFSTAGE], motion);
		if (exit) {
			exit.finished.then(
				() => host.remove(),
				() => host.remove(),
			);
		} else {
			host.remove();
		}
	};

	const close = doc.createElement("button");
	close.type = "button";
	close.className = "close";
	close.innerHTML = CLOSE_ICON;
	close.setAttribute("aria-label", "Dismiss");
	close.addEventListener("click", dismiss);

	panel.append(label, toggle, close);
	shadow.append(style, panel);
	render();
	doc.body.append(host);
	animatePanel(panel, [OFFSTAGE, ONSTAGE], motion);

	return {
		update(next) {
			changes = next;
			showingOriginal = false;
			render();
		},
		dismiss,
	};
}

function animatePanel(
	panel: HTMLElement,
	keyframes: Keyframe[],
	motion: Motion,
): Animation | null {
	switch (motion) {
		case "instant":
			return null;
		case "reduced":
			return panel.animate(
				keyframes.map((k) => ({ opacity: k.opacity ?? 1 })),
				{ duration: 150, easing: "ease-out", fill: "forwards" },
			);
		case "full":
			return panel.animate(keyframes, {
				duration: SURFACE_SPRING.duration,
				easing: SURFACE_SPRING.easing,
				fill: "forwards",
			});
	}
}
