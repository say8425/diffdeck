export type TreeSide = "left" | "right";

export const TREE_SIDE_KEY = "cc-statusline:tree-side";
export const FLATTEN_KEY = "cc-statusline:flatten";

export type Getter = (key: string) => string | null;

export const readTreeSide = (get: Getter): TreeSide =>
	get(TREE_SIDE_KEY) === "right" ? "right" : "left";

// Default on; only an explicit "0" disables flatten.
export const readFlatten = (get: Getter): boolean => get(FLATTEN_KEY) !== "0";

export const WATCH_KEY = "cc-statusline:diff-watch";
export const FOLD_WITH_TREE_KEY = "cc-statusline:fold-with-tree";

export const resolveUntracked = (urlParam: string | null): boolean =>
	urlParam === "1";

// Session-only, like resolveUntracked: no localStorage fallback — every
// fresh load starts visible unless the URL explicitly says otherwise.
export const resolveTreeHidden = (urlParam: string | null): boolean =>
	urlParam === "0";

export const resolveDiffStyle = (
	urlParam: string | null,
): "unified" | "split" => (urlParam === "split" ? "split" : "unified");

export const resolveFlatten = (
	urlParam: string | null,
	get: Getter,
): boolean =>
	urlParam === "0" ? false : urlParam === "1" ? true : readFlatten(get);

export const resolveTreeSide = (
	urlParam: string | null,
	get: Getter,
): TreeSide =>
	urlParam === "right"
		? "right"
		: urlParam === "left"
			? "left"
			: readTreeSide(get);

export const resolveWatch = (urlParam: string | null, get: Getter): boolean =>
	urlParam === "1" ? true : urlParam === "0" ? false : get(WATCH_KEY) === "1";

export const resolveFoldWithTree = (
	urlParam: string | null,
	get: Getter,
): boolean =>
	urlParam === "1"
		? true
		: urlParam === "0"
			? false
			: get(FOLD_WITH_TREE_KEY) === "1";

export const TREE_WIDTH_KEY = "cc-statusline:tree-width";
export const DEFAULT_TREE_WIDTH = 300;
export const MIN_TREE_WIDTH = 180;
export const MAX_TREE_WIDTH = 600;

export const clampTreeWidth = (width: number): number =>
	Number.isFinite(width)
		? Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, width))
		: DEFAULT_TREE_WIDTH;

// No URL-param layer (unlike resolveTreeSide/resolveFlatten): there is no
// launch-time flag for width, so this reads localStorage only.
export const readTreeWidth = (get: Getter): number => {
	const stored = get(TREE_WIDTH_KEY);
	return stored === null ? DEFAULT_TREE_WIDTH : clampTreeWidth(Number(stored));
};
