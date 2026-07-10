// Reconstructed from ~/dev/cc-statusline/node_modules/@pierre/trees/dist/react/jsx.d.ts.
//
// The upstream @pierre/trees source maps do not contain sourcesContent for
// this file: it is an ambient-only module (no runtime JS emitted), so
// esbuild/tsc never emitted a src/react/jsx.js (and therefore no .js.map)
// to extract from. Recovered verbatim from the shipped .d.ts. Matches the
// identical FILE_TREE_TAG_NAME-for-DIFFS_TAG_NAME pattern already
// reconstructed for packages/diffs (packages/diffs/src/react/jsx.d.ts).

import { FILE_TREE_TAG_NAME } from "../constants";

declare module "react" {
	namespace JSX {
		interface IntrinsicElements {
			[FILE_TREE_TAG_NAME]: React.DetailedHTMLProps<
				React.HTMLAttributes<HTMLElement>,
				HTMLElement
			>;
		}
	}
}
