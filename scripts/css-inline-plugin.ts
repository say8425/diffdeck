// Resolve Vite-style `*.css?inline` imports (used by the forked packages) to the CSS
// text as a default export. Both plugins must stay narrow: an onLoad that matched
// plain `.css` would silently swallow `import "./foo.css"` into JS.
//
// Two plugins because no single config works in both places: the runtime loader keeps
// the `?inline` query but rejects the namespace trick, so it uses onLoad only; the
// bundler rejects the query up front, so it strips it in onResolve and confines onLoad
// to a namespace.
import type { BunPlugin } from "bun";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const NAMESPACE = "diffdeck-css-inline";
const INLINE_QUERY = /\.css\?inline$/;

const stripQuery = (path: string): string => path.replace(/\?inline$/, "");

const readAsDefaultExport = (cssPath: string): string =>
	`export default ${JSON.stringify(readFileSync(cssPath, "utf8"))};`;

// Runtime (`bun test` / `bun run`): register via `Bun.plugin(...)`.
export const cssInlineRuntimePlugin: BunPlugin = {
	name: "diffdeck-css-inline-runtime",
	setup(build) {
		build.onLoad({ filter: INLINE_QUERY }, (args) => ({
			contents: readAsDefaultExport(stripQuery(args.path)),
			loader: "js",
		}));
	},
};

// Bundler (`Bun.build({ plugins })`).
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
