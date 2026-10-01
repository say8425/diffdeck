export type TreeSide = "left" | "right";

// `cc-statusline:` 키는 이름을 바꾸지 않는다 — 마이그레이션이 없어 사용자
// 설정이 조용히 초기화된다.
export const TREE_SIDE_KEY = "cc-statusline:tree-side";
export const FLATTEN_KEY = "cc-statusline:flatten";

export type Getter = (key: string) => string | null;

export const readTreeSide = (get: Getter): TreeSide =>
	get(TREE_SIDE_KEY) === "right" ? "right" : "left";

export const readFlatten = (get: Getter): boolean => get(FLATTEN_KEY) !== "0";

export const WATCH_KEY = "cc-statusline:diff-watch";
export const FOLD_WITH_TREE_KEY = "cc-statusline:fold-with-tree";

export const resolveUntracked = (urlParam: string | null): boolean =>
	urlParam === "1";

// Session-only like resolveUntracked: no localStorage fallback.
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

// No URL layer: there is no launch flag for width.
export const readTreeWidth = (get: Getter): number => {
	const stored = get(TREE_WIDTH_KEY);
	return stored === null ? DEFAULT_TREE_WIDTH : clampTreeWidth(Number(stored));
};

// 리포 경로로 네임스페이스한다 — 워크트리마다 기준이 다르다.
export const compareBaseKey = (repo: string): string =>
	`diffdeck:compare-base:${repo}`;

// null은 "고른 적 없음"이다(자동 base 전환이 이것으로 판정한다). 그때 무엇을
// 보낼지는 호출부가 정한다.
export const resolveCompareBase = (
	urlParam: string | null,
	get: Getter,
	repo: string,
): string | null =>
	urlParam !== null && urlParam !== "" ? urlParam : get(compareBaseKey(repo));
