import {
	createThemeCollection,
	type ThemeCollection,
	type ThemeDescriptor,
	type ThemeLike,
} from "../index";
import { createTheme } from "../modules/createTheme";

const PIERRE_COLLECTION = "pierre";

/*
 * Pierre theme order
 */

const DARK_PIERRE_THEMES = [
	"pierre-dark",
	"pierre-dark-soft",
	"pierre-dark-vibrant",
	"pierre-dark-protanopia-deuteranopia",
	"pierre-dark-tritanopia",
] as const;
const LIGHT_PIERRE_THEMES = [
	"pierre-light",
	"pierre-light-soft",
	"pierre-light-vibrant",
	"pierre-light-protanopia-deuteranopia",
	"pierre-light-tritanopia",
] as const;
const PIERRE_THEMES = [...LIGHT_PIERRE_THEMES, ...DARK_PIERRE_THEMES] as const;

type PierreThemeName = (typeof PIERRE_THEMES)[number];

const LIGHT_PIERRE_THEME_NAMES = new Set<string>(LIGHT_PIERRE_THEMES);

function pierreColorScheme(name: PierreThemeName): "light" | "dark" {
	if (LIGHT_PIERRE_THEME_NAMES.has(name)) return "light";
	return "dark";
}

/*
 * Pierre theme metadata
 */

const PIERRE_THEME_DISPLAY_NAMES = {
	"pierre-dark": "Pierre Dark",
	"pierre-dark-soft": "Pierre Dark Soft",
	"pierre-dark-vibrant": "Pierre Dark Vibrant",
	"pierre-dark-protanopia-deuteranopia":
		"Pierre Dark Protanopia & Deuteranopia",
	"pierre-dark-tritanopia": "Pierre Dark Tritanopia",
	"pierre-light": "Pierre Light",
	"pierre-light-soft": "Pierre Light Soft",
	"pierre-light-vibrant": "Pierre Light Vibrant",
	"pierre-light-protanopia-deuteranopia":
		"Pierre Light Protanopia & Deuteranopia",
	"pierre-light-tritanopia": "Pierre Light Tritanopia",
} as const satisfies Record<PierreThemeName, string>;

/*
 * Pierre theme loaders
 *
 * Upstream loads these from the `@pierre/theme` npm package
 * (`@pierre/theme/pierre-dark`, etc). diffdeck vendors that package's theme
 * JSON directly under `themes/` (see packages/theming/themes/*.json, copied
 * from @pierre/theme in Task 4) instead of depending on the package, so these
 * loaders import the local JSON. TypeScript's `resolveJsonModule` infers
 * widened (non-literal) types for JSON properties, so each loader's return
 * type is asserted back to `ThemeLike` — the runtime shape is identical to
 * upstream's `PierreTheme` (verified against `@pierre/theme`'s `.d.mts`).
 */

const PIERRE_THEME_IMPORTS: Record<
	PierreThemeName,
	() => Promise<{ default: ThemeLike }>
> = {
	"pierre-dark": () =>
		import("../../themes/pierre-dark.json") as Promise<{ default: ThemeLike }>,
	"pierre-dark-soft": () =>
		import("../../themes/pierre-dark-soft.json") as Promise<{
			default: ThemeLike;
		}>,
	"pierre-dark-vibrant": () =>
		import("../../themes/pierre-dark-vibrant.json") as Promise<{
			default: ThemeLike;
		}>,
	"pierre-dark-protanopia-deuteranopia": () =>
		import("../../themes/pierre-dark-protanopia-deuteranopia.json") as Promise<{
			default: ThemeLike;
		}>,
	"pierre-dark-tritanopia": () =>
		import("../../themes/pierre-dark-tritanopia.json") as Promise<{
			default: ThemeLike;
		}>,
	"pierre-light": () =>
		import("../../themes/pierre-light.json") as Promise<{
			default: ThemeLike;
		}>,
	"pierre-light-soft": () =>
		import("../../themes/pierre-light-soft.json") as Promise<{
			default: ThemeLike;
		}>,
	"pierre-light-vibrant": () =>
		import("../../themes/pierre-light-vibrant.json") as Promise<{
			default: ThemeLike;
		}>,
	"pierre-light-protanopia-deuteranopia": () =>
		import("../../themes/pierre-light-protanopia-deuteranopia.json") as Promise<{
			default: ThemeLike;
		}>,
	"pierre-light-tritanopia": () =>
		import("../../themes/pierre-light-tritanopia.json") as Promise<{
			default: ThemeLike;
		}>,
};

function createPierreTheme(name: PierreThemeName): ThemeDescriptor {
	return createTheme({
		name,
		collection: PIERRE_COLLECTION,
		colorScheme: pierreColorScheme(name),
		displayName: PIERRE_THEME_DISPLAY_NAMES[name],
		load: PIERRE_THEME_IMPORTS[name],
	});
}

export const pierreThemes: ThemeCollection = createThemeCollection({
	themes: PIERRE_THEMES.map((name) => createPierreTheme(name)),
});
