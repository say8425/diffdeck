// Bun plugins: resolve Vite-style `*.css?inline` imports to the CSS file's raw
// text as a default string export — WITHOUT interfering with plain `.css`
// imports elsewhere in the graph.
//
// The forked @diffdeck/diffs and @diffdeck/trees packages carry their real
// stylesheets at `src/style.css` and import them with
// `import styles from '../style.css?inline'` (Vite's `?inline` = "give me the
// file contents as a string", not a URL or an injected <style>). Bun does not
// understand the `?inline` query suffix on its own, so without a plugin the
// specifier is unresolvable. These plugins strip `?inline`, read the sibling
// `.css`, and return its text as a default string export, which the packages
// interpolate straight into their shadow-DOM <style> content.
//
// WHY TWO PLUGINS. The runtime module loader (`bun test`, `bun run`) and the
// bundler (`Bun.build`) have incompatible constraints, and each must stay
// *narrow* — an over-broad `onLoad` that matched plain `.css` would silently
// swallow any `import "./foo.css"` into JS (no separate CSS asset, no error):
//
//   * Runtime — the bundler's namespace trick is rejected here
//     ("Cannot resolve invalid URL 'ns:/abs/path'"), and an onResolve that
//     rewrites to a plain `.css` path makes Bun apply its native CSS handling
//     (yields a URL, not the text). What DOES work: the runtime resolver keeps
//     the `?inline` query and hands it to onLoad, so an onLoad filtered on
//     `\.css\?inline$` (no onResolve) intercepts ONLY `?inline` specifiers and
//     leaves plain `.css` to Bun.
//   * Bundler — its resolver rejects the `?inline` query up front, so it needs
//     an onResolve to strip it. The standard esbuild/Bun namespace pattern
//     tags only `?inline` specifiers and confines onLoad to that namespace, so
//     plain `.css` stays in the default namespace and is emitted natively.
//
// There is no single onResolve+onLoad config that is both narrow and works in
// both environments (verified empirically against Bun 1.3.12), hence one narrow
// plugin per environment, sharing the read helper. Plan 2's real build.ts
// should import `cssInlineBundlerPlugin` for `Bun.build`, and its test setup
// should preload `cssInlineRuntimePlugin`.
import type { BunPlugin } from "bun";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const NAMESPACE = "diffdeck-css-inline";
const INLINE_QUERY = /\.css\?inline$/;

const stripQuery = (path: string): string => path.replace(/\?inline$/, "");

const readAsDefaultExport = (cssPath: string): string =>
	`export default ${JSON.stringify(readFileSync(cssPath, "utf8"))};`;

// Runtime (`bun test` / `bun run`): register via `Bun.plugin(...)`.
// onLoad-only on the `?inline` query form — never touches plain `.css`.
export const cssInlineRuntimePlugin: BunPlugin = {
	name: "diffdeck-css-inline-runtime",
	setup(build) {
		build.onLoad({ filter: INLINE_QUERY }, (args) => ({
			contents: readAsDefaultExport(stripQuery(args.path)),
			loader: "js",
		}));
	},
};

// Bundler (`Bun.build({ plugins })`): namespace pattern. onResolve tags ONLY
// `?inline` specifiers; onLoad fires ONLY for that namespace, so plain `.css`
// stays in the default namespace and is handled natively by Bun (emitted as a
// separate asset rather than swallowed into JS).
export const cssInlineBundlerPlugin: BunPlugin = {
	name: "diffdeck-css-inline-bundler",
	setup(build) {
		build.onResolve({ filter: INLINE_QUERY }, (args) => {
			const base = args.importer ? dirname(args.importer) : process.cwd();
			return {
				path: resolve(base, stripQuery(args.path)),
				namespace: NAMESPACE,
			};
		});
		build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => ({
			contents: readAsDefaultExport(args.path),
			loader: "js",
		}));
	},
};
