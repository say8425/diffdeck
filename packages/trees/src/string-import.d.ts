// Reconstructed from ~/dev/cc-statusline/node_modules/@pierre/trees/dist/string-import.d.ts.
//
// The upstream @pierre/trees source maps do not contain sourcesContent for
// this file: it is an ambient-only module (no runtime JS emitted), so
// esbuild/tsc never emitted a src/string-import.js (and therefore no
// .js.map) to extract from. Recovered verbatim from the shipped .d.ts.
// Matches the identical reconstruction already done for packages/diffs
// (packages/diffs/src/string-import.d.ts).

declare module "*.css" {
	const file: string;
	export default file;
}
declare module "*.css?inline" {
	const file: string;
	export default file;
}
declare module "*?raw" {
	const file: string;
	export default file;
}
