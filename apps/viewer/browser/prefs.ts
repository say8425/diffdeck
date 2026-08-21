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

/**
 * 견줄 기준의 저장 키. 리포 경로로 네임스페이스한다 — 워크트리마다 견주는
 * 기준이 다른데, 위의 여섯 `cc-statusline:` 키처럼 공유해 버리면 한 워크트리의
 * 선택이 다른 워크트리로 새어 나간다. (그 여섯은 마이그레이션 코드가 없어
 * 이름을 바꾸면 모든 사용자의 설정이 조용히 초기화되므로 그대로 둔다.)
 */
export const compareBaseKey = (repo: string): string =>
	`diffdeck:compare-base:${repo}`;

/**
 * URL 파라미터 → localStorage → null. null이면 `base`를 아예 보내지 않고
 * 서버가 자동 해석하므로, 아무것도 고르지 않은 사용자는 오늘과 같은 화면을
 * 본다.
 */
export const resolveCompareBase = (
	urlParam: string | null,
	get: Getter,
	repo: string,
): string | null =>
	urlParam !== null && urlParam !== "" ? urlParam : get(compareBaseKey(repo));
