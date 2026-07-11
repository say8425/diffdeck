// 브라우저 뷰어 번들 빌드. 포크 패키지(@diffdeck/diffs·trees)가 `../style.css?inline`을
// import하므로 css-inline 번들러 플러그인을 반드시 attach한다(패리티 하니스 build.ts와 동일
// 패턴). 산출: dist/main.js(minify) + dist/index.html(복사). 서버의 viewerDir가 이 dist.
import { cssInlineBundlerPlugin } from "../../scripts/css-inline-plugin.ts";

const outdir = `${import.meta.dir}/dist`;

const result = await Bun.build({
	entrypoints: [`${import.meta.dir}/browser/main.ts`],
	target: "browser",
	outdir,
	minify: true,
	plugins: [cssInlineBundlerPlugin],
});

for (const log of result.logs) console.log(log);
if (!result.success) {
	console.error("viewer build failed");
	process.exit(1);
}

await Bun.write(
	`${outdir}/index.html`,
	Bun.file(`${import.meta.dir}/index.html`),
);

const [entry] = result.outputs;
console.log(
	`viewer build: ${entry?.path} (${((entry?.size ?? 0) / 1_000_000).toFixed(2)} MB)`,
);
