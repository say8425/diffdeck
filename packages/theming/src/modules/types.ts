/**
 * Reconstructed from the upstream compiled `dist/modules/types.d.ts` (Task 4):
 * this module is pure types with no runtime code, so esbuild never emitted a
 * `types.js`/`types.js.map` for it and `extractSources` had no `sourcesContent`
 * to recover it from.
 */

export interface ThemeLike {
	bg?: string;
	colors?: Record<string, string>;
	fg?: string;
	name?: string;
	type?: "dark" | "light";
}

export type ColorScheme = "dark" | "light";

export type ColorMode = ColorScheme | "system";
