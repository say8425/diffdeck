// Two bundles:
//  1) dist/cli.js       — bin entry (server + CLI), target bun.
//  2) dist/viewer/*     — browser viewer bundle. The forked @diffdeck/* packages
//                         import `../style.css?inline`, so the css-inline plugin
//                         must stay attached (parity with the harness build.ts).
// Layout mirrors cc-statusline: dist/cli.js + dist/viewer/{main.js,index.html}.
import { cssInlineBundlerPlugin } from "../../scripts/css-inline-plugin.ts";

const dist = `${import.meta.dir}/dist`;

const cli = await Bun.build({
	entrypoints: [`${import.meta.dir}/cli.ts`],
	target: "bun",
	outdir: dist,
});
for (const log of cli.logs) console.log(log);
if (!cli.success) {
	console.error("cli build failed");
	process.exit(1);
}

const viewer = await Bun.build({
	entrypoints: [`${import.meta.dir}/browser/main.ts`],
	target: "browser",
	outdir: `${dist}/viewer`,
	minify: true,
	plugins: [cssInlineBundlerPlugin],
});
for (const log of viewer.logs) console.log(log);
if (!viewer.success) {
	console.error("viewer build failed");
	process.exit(1);
}

await Bun.write(
	`${dist}/viewer/index.html`,
	Bun.file(`${import.meta.dir}/index.html`),
);

const [entry] = viewer.outputs;
console.log(
	`viewer build: ${entry?.path} (${((entry?.size ?? 0) / 1_000_000).toFixed(2)} MB)`,
);
