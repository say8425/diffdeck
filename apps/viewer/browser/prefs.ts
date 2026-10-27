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

export const DIFF_STYLE_KEY = "diffdeck:diff-style";

export const resolveDiffStyle = (
	urlParam: string | null,
	get: Getter,
): "unified" | "split" =>
	urlParam === "split"
		? "split"
		: urlParam === "unified"
			? "unified"
			: get(DIFF_STYLE_KEY) === "split"
				? "split"
				: "unified";

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

export const FONT_SCALE_KEY = "diffdeck:font-scale";
export const MIN_FONT_SCALE = 0.8;
export const MAX_FONT_SCALE = 2;
// 엔진 기본값(style.css의 --diffs-font-size·--diffs-line-height 폴백)과 같아야
// ×1이 지금 화면과 같다.
export const BASE_CODE_FONT_SIZE = 13;
export const BASE_CODE_LINE_HEIGHT = 20;

// 0.1 단위로 반올림한다 — 1.1 + 0.1 같은 부동소수 오차가 저장값과 라벨에
// 새지 않게.
export const clampFontScale = (scale: number): number =>
	Number.isFinite(scale)
		? Math.min(
				MAX_FONT_SCALE,
				Math.max(MIN_FONT_SCALE, Math.round(scale * 10) / 10),
			)
		: 1;

// No URL layer: there is no launch flag for font size.
export const readFontScale = (get: Getter): number => {
	const stored = get(FONT_SCALE_KEY);
	return stored === null || stored.trim() === ""
		? 1
		: clampFontScale(Number(stored));
};

export const stepFontScale = (scale: number, direction: 1 | -1): number =>
	clampFontScale(scale + direction / 10);

export const fontScaleLabel = (scale: number): string => `×${scale}`;

// 라벨의 "×1.2"는 스크린 리더가 맥락 없이 읽으므로 따로 문장을 둔다.
export const fontScaleAnnouncement = (scale: number): string =>
	`Font size ${Math.round(scale * 100)}%`;

// 줄 높이는 정수로 둔다 — 엔진의 가상화가 같은 값을 itemMetrics.lineHeight로
// 받아 아직 그리지 않은 줄의 높이를 추정한다.
export const codeMetrics = (
	scale: number,
): { fontSize: number; lineHeight: number } => ({
	fontSize: Math.round(BASE_CODE_FONT_SIZE * scale * 10) / 10,
	lineHeight: Math.round(BASE_CODE_LINE_HEIGHT * scale),
});

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
