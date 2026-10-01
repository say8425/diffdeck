import { chmodSync, rmSync } from "node:fs";
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

// Shebang + exec bit so the bin also runs via npx/direct exec, not only `bunx`. It goes
// above Bun.build's `// @bun` line, which bun still honors.
const cliPath = `${dist}/cli.js`;
const cliSource = await Bun.file(cliPath).text();
if (!cliSource.startsWith("#!")) {
	await Bun.write(cliPath, `#!/usr/bin/env bun\n${cliSource}`);
}
chmodSync(cliPath, 0o755);

// The forked packages import `../style.css?inline`, which needs the css-inline plugin.
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

// main.ts가 new URL("worker.js", import.meta.url)로 로드하므로 main.js 옆에 둔다.
// worker.ts는 CSS를 import하지 않아 css-inline 플러그인이 필요 없다.
const worker = await Bun.build({
	entrypoints: [`${import.meta.dir}/../../packages/diffs/src/worker/worker.ts`],
	target: "browser",
	outdir: `${dist}/viewer`,
	minify: true,
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

// 폰트와 OFL 라이선스를 싣는다(OFL은 함께 배포를 요구한다, README.md는 뺀다). 먼저
// 비운다 — 지운 폰트가 남아 tarball에 섞이지 않게.
rmSync(`${dist}/viewer/fonts`, { recursive: true, force: true });
for await (const name of new Bun.Glob("*.{woff2,txt}").scan(
	`${import.meta.dir}/fonts`,
)) {
	await Bun.write(
		`${dist}/viewer/fonts/${name}`,
		Bun.file(`${import.meta.dir}/fonts/${name}`),
	);
}

await Bun.write(
	`${dist}/skills/diffdeck/SKILL.md`,
	Bun.file(`${import.meta.dir}/../../skills/diffdeck/SKILL.md`),
);

const [entry] = viewer.outputs;
console.log(
	`viewer build: ${entry?.path} (${((entry?.size ?? 0) / 1_000_000).toFixed(2)} MB)`,
);
