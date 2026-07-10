// Builds the render-parity harness bundle with the reusable css-inline bundler
// plugin (scripts/css-inline-plugin.ts) so the forked packages'
// `../style.css?inline` imports are inlined as real stylesheet text, while any
// plain `.css` import stays a native asset.
//
// A dedicated Bun.build() script (rather than the `bun build` CLI) because the
// CLI has no flag to attach a bundler plugin — `--preload` bundles the plugin
// file itself for the browser target and fails on its `bun` builtin import.
// Run: `bun run scripts/parity/build.ts`.
import { cssInlineBundlerPlugin } from "../css-inline-plugin.ts";

const result = await Bun.build({
	entrypoints: [`${import.meta.dir}/main.ts`],
	target: "browser",
	outdir: `${import.meta.dir}/out`,
	plugins: [cssInlineBundlerPlugin],
});

for (const log of result.logs) console.log(log);

if (!result.success) {
	console.error("build failed");
	process.exit(1);
}

const [entry] = result.outputs;
console.log(
	`build success: ${entry?.path} (${((entry?.size ?? 0) / 1_000_000).toFixed(2)} MB)`,
);
