// Two bundles:
//  1) dist/cli.js       — bin entry (server + CLI), target bun.
//  2) dist/viewer/*     — browser viewer bundle. The forked @diffdeck/* packages
//                         import `../style.css?inline`, so the css-inline plugin
//                         must stay attached (parity with the harness build.ts).
// Layout mirrors cc-statusline: dist/cli.js + dist/viewer/{main.js,index.html}.
import { chmodSync } from "node:fs";
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

// Prepend a bun shebang + set the exec bit so the published bin runs via
// npx/direct exec, not only `bunx`. Bun.build emits `// @bun` as line 1; the
// shebang goes above it (bun skips the shebang line and still honors `// @bun`).
const cliPath = `${dist}/cli.js`;
const cliSource = await Bun.file(cliPath).text();
if (!cliSource.startsWith("#!")) {
	await Bun.write(cliPath, `#!/usr/bin/env bun\n${cliSource}`);
}
chmodSync(cliPath, 0o755);

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

// 워커 하이라이트 번들: vendored 워커 엔트리를 별도 모듈 워커로 빌드한다.
// main.ts의 workerFactory가 new URL("worker.js", import.meta.url)로 로드.
const worker = await Bun.build({
	entrypoints: [`${import.meta.dir}/../../packages/diffs/src/worker/worker.ts`],
	target: "browser",
	outdir: `${dist}/viewer`,
	minify: true,
	plugins: [cssInlineBundlerPlugin],
});
for (const log of worker.logs) console.log(log);
if (!worker.success) {
	console.error("worker build failed");
	process.exit(1);
}

await Bun.write(
	`${dist}/viewer/index.html`,
	Bun.file(`${import.meta.dir}/index.html`),
);

await Bun.write(
	`${dist}/skills/diffdeck/SKILL.md`,
	Bun.file(`${import.meta.dir}/../../skills/diffdeck/SKILL.md`),
);

const [entry] = viewer.outputs;
console.log(
	`viewer build: ${entry?.path} (${((entry?.size ?? 0) / 1_000_000).toFixed(2)} MB)`,
);
