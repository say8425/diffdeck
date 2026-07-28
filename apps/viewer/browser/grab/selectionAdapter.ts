// 네이티브 Selection의 덕타입 파사드. Chrome의 사용자 드래그 선택은
// window.getSelection() 끝점이 light DOM으로 rescope되므로(스펙 §경로 B),
// primary는 getComposedRanges({shadowRoots}) — 반드시 옵션백 시그니처(가변인자
// 레거시는 Chrome이 조용히 무시한다). fallback은 비표준 shadowRoot.getSelection()
// (단일 root 한정). 덕타입인 이유: happy-dom엔 둘 다 없어, 게이트 안에서 fake로
// 전 분기를 커버하려면 실 DOM 타입에 묶이면 안 된다.
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
	getComposedRanges?: (options: { shadowRoots: readonly GrabRoot[] }) => readonly RangeEndpoints[];
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
	if (!selection || selection.isCollapsed) return null;
	if (typeof selection.getComposedRanges === "function") {
		const range = selection.getComposedRanges({ shadowRoots: roots })[0];
		if (!range) return null;
		return { range, backward: selection.direction === "backward" };
	}
	for (const root of roots) {
		const sel = root.getSelection?.();
		if (sel && !sel.isCollapsed && (sel.rangeCount ?? 0) > 0 && sel.getRangeAt) {
			return { range: sel.getRangeAt(0), backward: false };
		}
	}
	return null;
};
