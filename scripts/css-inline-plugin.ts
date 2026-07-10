// Bun plugin: resolve Vite-style `*.css?inline` imports to the CSS file's raw
// text as a default string export.
//
// The forked @diffdeck/diffs and @diffdeck/trees packages carry their real
// stylesheets at `src/style.css` and import them with
// `import styles from '../style.css?inline'` (Vite's `?inline` = "give me the
// file contents as a string", not a URL or an injected <style>). Bun does not
// understand the `?inline` query suffix on its own, so without this plugin the
// specifier is unresolvable. This plugin strips `?inline`, resolves the sibling
// `.css` file, and returns its text as a default string export, which the
// packages interpolate straight into their shadow-DOM <style> content.
//
// Works for BOTH:
//   * `bun test` (runtime): registered via bunfig.toml `[test] preload` ->
//     scripts/parity/preload.ts. The runtime module loader rejects custom
//     namespaces and only accepts js/ts/json/... loaders (not "text"), so this
//     plugin stays in the default namespace and emits `export default "<css>"`
//     via the "js" loader.
//   * `bun build` (bundler): imported and passed in `Bun.build({ plugins })`
//     from scripts/parity/build.ts. The bundler's own resolver rejects the
//     `?inline` query up front, hence the onResolve that strips it; the same
//     onLoad then inlines the text.
//
// Plan 2's real build.ts should reuse this exact module rather than
// re-deriving the loader.
import type { BunPlugin } from "bun";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const INLINE_CSS_RESOLVE = /\.css\?inline$/;
// onLoad must match both the runtime form (query still attached, since the
// runtime resolver keeps it) and the bundler form (query already stripped by
// the onResolve below).
const INLINE_CSS_LOAD = /\.css(\?inline)?$/;

const stripQuery = (path: string): string => path.replace(/\?inline$/, "");

export const cssInlinePlugin: BunPlugin = {
	name: "diffdeck-css-inline",
	setup(build) {
		// Strip `?inline` and resolve the sibling .css relative to the importer so
		// the bundler's resolver accepts the specifier. Left in the default
		// namespace on purpose — a custom namespace works in the bundler but breaks
		// the runtime loader.
		build.onResolve({ filter: INLINE_CSS_RESOLVE }, (args) => {
			const base = args.importer ? dirname(args.importer) : process.cwd();
			return { path: resolve(base, stripQuery(args.path)) };
		});
		build.onLoad({ filter: INLINE_CSS_LOAD }, (args) => ({
			contents: `export default ${JSON.stringify(readFileSync(stripQuery(args.path), "utf8"))};`,
			loader: "js",
		}));
	},
};

export default cssInlinePlugin;
