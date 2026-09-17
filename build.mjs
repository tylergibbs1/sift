import { cp, rm } from "node:fs/promises";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

await rm("dist", { recursive: true, force: true });
await cp("static", "dist", { recursive: true });

const ctx = await esbuild.context({
	entryPoints: {
		background: "src/background.ts",
		content: "src/content.ts",
		options: "src/options.ts",
	},
	outdir: "dist",
	bundle: true,
	format: "iife",
	target: "chrome120",
	sourcemap: "linked",
	logLevel: "info",
});

if (watch) {
	await ctx.watch();
} else {
	await ctx.rebuild();
	await ctx.dispose();
}
