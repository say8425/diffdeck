// Runtime (bun test / bun run) preload plugin: @diffdeck/diffs and
// @diffdeck/trees both import a sibling `style.css` via a `?inline` query
// (e.g. `import rawStyles from '../style.css?inline'` in
// packages/diffs/src/utils/cssWrappers.ts and packages/trees/src/render/FileTree.ts).
// That style.css was never recovered by the source-map extraction that built
// these forks (the upstream dist/style.js.map ships empty sources/sourcesContent),
// so the file is genuinely absent from both packages' src/ trees — not a typecheck
// gap, a real missing runtime asset. Rather than fabricate the file inside the
// forked package source (out of scope for this harness), this plugin redirects
// any `*.css` / `*.css?inline` resolution to a local, content-free stub so the
// module graph loads. It does not restore real styling — see empty.css.
//
// Bun's runtime module loader only lets onResolve/onLoad intercept imports that
// resolve to a real file (custom virtual namespaces are bundler-only, confirmed
// empirically), hence the redirect-to-a-real-stub-file approach instead of a
// fully virtual module.
import { plugin } from "bun";
import { resolve } from "node:path";

const STUB_CSS_PATH = resolve(import.meta.dir, "empty.css");

await plugin({
	name: "diffdeck-parity-css-stub",
	setup(build) {
		build.onResolve({ filter: /\.css(\?inline)?$/ }, () => ({
			path: STUB_CSS_PATH,
		}));
	},
});
