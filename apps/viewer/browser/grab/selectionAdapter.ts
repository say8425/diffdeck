// Chrome은 window.getSelection()의 끝점을 light DOM으로 rescope하므로
// getComposedRanges({shadowRoots})를 먼저 쓴다 — 옵션 객체 시그니처여야 한다(가변
// 인자 레거시는 Chrome이 조용히 무시한다). 덕타입인 것은 happy-dom에
// getComposedRanges도 shadowRoot.getSelection도 없어서다.
export interface RangeEndpoints {
	startContainer: Node;
	startOffset: number;
	endContainer: Node;
	endOffset: number;
}

export interface SelectionLike {
	isCollapsed: boolean;
	rangeCount?: number;
	direction?: string;
	getComposedRanges?: (options: {
		shadowRoots: readonly GrabRoot[];
	}) => readonly RangeEndpoints[];
	getRangeAt?: (index: number) => RangeEndpoints;
}

export interface GrabRoot {
	getSelection?: () => SelectionLike | null;
}

export interface ResolvedSelection {
	range: RangeEndpoints;
	backward: boolean;
}

export const resolveSelectionRange = (
	selection: SelectionLike | null,
	roots: readonly GrabRoot[],
): ResolvedSelection | null => {
	if (!selection) return null;
	if (typeof selection.getComposedRanges === "function") {
		const range = selection.getComposedRanges({ shadowRoots: roots })[0];
		if (!range) return null;
		// selection.isCollapsed는 shadow rescope 때문에 믿을 수 없어 끝점을 직접
		// 비교한다.
		if (
			range.startContainer === range.endContainer &&
			range.startOffset === range.endOffset
		) {
			return null;
		}
		return { range, backward: selection.direction === "backward" };
	}
	for (const root of roots) {
		const sel = root.getSelection?.();
		if (
			sel &&
			!sel.isCollapsed &&
			(sel.rangeCount ?? 0) > 0 &&
			sel.getRangeAt
		) {
			return { range: sel.getRangeAt(0), backward: false };
		}
	}
	return null;
};
