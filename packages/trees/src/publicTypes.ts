// Reconstructed from ~/dev/cc-statusline/node_modules/@pierre/trees/dist/publicTypes.d.ts.
//
// The upstream @pierre/trees source maps do not contain sourcesContent for
// this file: it is a type-only module, so esbuild/tsc never emitted a
// src/publicTypes.js (and therefore no .js.map) to extract from. Recovered
// verbatim from the shipped .d.ts (declare/type-emit syntax stripped —
// none was present beyond plain type/interface declarations).

export type GitStatus =
	| "added"
	| "deleted"
	| "ignored"
	| "modified"
	| "renamed"
	| "untracked";

export type GitStatusEntry = {
	path: string;
	status: GitStatus;
};

export type ContextMenuAnchorRect = Readonly<{
	top: number;
	right: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
	x: number;
	y: number;
}>;
