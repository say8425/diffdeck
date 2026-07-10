/**
 * Authored barrel (Task 4): no `.js.map` was emitted for the upstream
 * `src/index.ts` entry file itself (only for the modules it re-exports), so
 * `extractSources` had no `sourcesContent` to recover it from. Reconstructed
 * to mirror the exact public surface listed in the upstream compiled
 * `dist/index.d.ts`.
 */

import type { ColorMode, ColorScheme, ThemeLike } from "./modules/types";
import {
	DuplicateThemeError,
	UnregisteredThemeError,
	UnresolvedThemeError,
	createThemeResolver,
	type ThemeLoader,
	type ThemeResolver,
} from "./modules/createThemeResolver";
import {
	createThemeCollection,
	type ThemeCollection,
	type ThemeCollectionComparator,
	type ThemeCollectionEntry,
	type ThemeCollectionFilter,
	type ThemeCollectionInput,
	type ThemeCollectionSource,
	type ThemeDescriptor,
} from "./modules/createThemeCollection";
import {
	createThemeCatalog,
	type ThemeCatalog,
} from "./modules/createThemeCatalog";
import {
	createThemeController,
	type PendingThemeResolution,
	type ThemeController,
	type ThemeControllerOptions,
	type ThemeControllerState,
	type ThemePersistence,
	type ThemeResolutionError,
	type ThemeResolutionErrorContext,
	type ThemeSelection,
} from "./modules/createThemeController";

export {
	type ColorMode,
	type ColorScheme,
	DuplicateThemeError,
	type PendingThemeResolution,
	type ThemeCatalog,
	type ThemeCollection,
	type ThemeCollectionComparator,
	type ThemeCollectionEntry,
	type ThemeCollectionFilter,
	type ThemeCollectionInput,
	type ThemeCollectionSource,
	type ThemeController,
	type ThemeControllerOptions,
	type ThemeControllerState,
	type ThemeDescriptor,
	type ThemeLike,
	type ThemeLoader,
	type ThemePersistence,
	type ThemeResolutionError,
	type ThemeResolutionErrorContext,
	type ThemeResolver,
	type ThemeSelection,
	UnregisteredThemeError,
	UnresolvedThemeError,
	createThemeCatalog,
	createThemeCollection,
	createThemeController,
	createThemeResolver,
};
