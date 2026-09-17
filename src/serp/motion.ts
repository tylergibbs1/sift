/**
 * A critically damped spring (damping ratio 1, no overshoot) expressed as a
 * CSS `linear()` easing, so Web Animations can play it without a library.
 * `response` is Apple's parameter: roughly how quickly the value arrives.
 */
export type SpringTiming = {
	readonly easing: string;
	readonly duration: number;
};

export function criticallyDampedSpring(responseSeconds: number): SpringTiming {
	const omega = (2 * Math.PI) / responseSeconds;
	// x(t) = 1 - (1 + ωt)e^(-ωt) is within 0.1% of the target once ωt ≈ 9.2.
	const settleSeconds = 9.2 / omega;
	const steps = 40;
	const points: string[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = (i / steps) * settleSeconds;
		const x = i === steps ? 1 : 1 - (1 + omega * t) * Math.exp(-omega * t);
		points.push(x.toFixed(4));
	}
	return {
		easing: `linear(${points.join(", ")})`,
		duration: Math.round(settleSeconds * 1000),
	};
}

/** Apple's default for repositioning content. */
export const MOVE_SPRING = criticallyDampedSpring(0.4);
/** Snappier, for small surfaces like the status panel. */
export const SURFACE_SPRING = criticallyDampedSpring(0.3);

/** "reduced" swaps movement for short cross-fades; "instant" is for tests. */
export type Motion = "full" | "reduced" | "instant";

export function motionFor(win: Window): Motion {
	return win.matchMedia("(prefers-reduced-motion: reduce)").matches
		? "reduced"
		: "full";
}
