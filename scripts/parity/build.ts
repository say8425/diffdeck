// A Bun.build() script rather than the `bun build` CLI: the CLI cannot attach a bundler
// plugin (`--preload` bundles the plugin file for the browser and fails on its `bun` import).
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
