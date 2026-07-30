// 컴포즈드 셀렉션 끝점(RangeEndpoints)을 (fileId, NormalizedRange)로 해석한다.
// 규칙 전문은 스펙 §경로 B. 여기의 DOM 계약: 행 = [data-line][data-line-type]
// [data-line-index], 파일 host = <diffs-container> + light-DOM [data-fold],
// split 컬럼 = code[data-deletions|data-additions].
import type {
	CharSpan,
	GrabPoint,
	GrabSide,
	NormalizedRange,
} from "./range.ts";
import type { RangeEndpoints, ResolvedSelection } from "./selectionAdapter.ts";

export interface TextGrabTarget {
	fileId: string;
	range: NormalizedRange;
}

interface Endpoint {
	root: ShadowRoot;
	fileId: string;
	rowEl: Element | null;
	/** 끝점이 [data-line] 안에 직접 떨어졌는가 (거터 복구가 아닌가). */
	direct: boolean;
	node: Node;
	offset: number;
}

const toElement = (node: Node): Element | null =>
	node instanceof Element ? node : node.parentElement;

const recoverFromGutter = (el: Element, root: ShadowRoot): Element | null => {
	const carrier = el.closest("[data-line-index]");
	const index = carrier?.getAttribute("data-line-index");
	if (!carrier || !index) return null;
	const scope = carrier.closest("code") ?? root;
	return scope.querySelector(`[data-line][data-line-index="${index}"]`);
};

const classify = (node: Node, offset: number): Endpoint | null => {
	const root = node.getRootNode();
	if (!(root instanceof ShadowRoot)) return null;
	if (root.host.tagName !== "DIFFS-CONTAINER") return null;
	const fileId =
		root.host.querySelector<HTMLElement>("[data-fold]")?.dataset.fold;
	if (!fileId) return null;
	const el = toElement(node);
	if (!el) return null;
	const own = el.closest("[data-line]");
	const rowEl = own ?? recoverFromGutter(el, root);
	return { root, fileId, rowEl, direct: own !== null, node, offset };
};

/**
 * 행 요소 안에서 (node, offset) 끝점이 몇 번째 문자인지. 행 밖이면 null.
 *
 * 엔진은 코드 행을 토큰별 <span>으로 쪼개 렌더하지만 행의 textContent는 파일
 * 원본 라인과 정확히 일치한다(탭 포함, 삽입 문자 없음 — 실측). 그래서 텍스트
 * 노드 길이를 문서순으로 누적하면 원본 라인 기준 오프셋이 나온다.
 */
export const charOffsetInRow = (
	rowEl: Element,
	node: Node,
	offset: number,
): number | null => {
	// 끝점이 행 요소 자체를 가리키는 경우(offset = 자식 인덱스)
	if (node === rowEl) {
		let acc = 0;
		const upto = Math.min(offset, rowEl.childNodes.length);
		for (let i = 0; i < upto; i += 1)
			acc += rowEl.childNodes[i].textContent?.length ?? 0;
		return acc;
	}
	if (!rowEl.contains(node)) return null;
	const walker = rowEl.ownerDocument.createTreeWalker(
		rowEl,
		NodeFilter.SHOW_TEXT,
	);
	let acc = 0;
	let current = walker.nextNode();
	while (current !== null) {
		if (current === node) return acc + offset;
		acc += (current as Text).data.length;
		current = walker.nextNode();
	}
	return null;
};

export const rowSide = (
	rowEl: Element,
	diffStyle: "unified" | "split",
): GrabSide => {
	const type = rowEl.getAttribute("data-line-type") ?? "";
	if (type.includes("deletion")) return "old";
	if (type.includes("addition")) return "new";
	if (
		diffStyle === "split" &&
		rowEl.closest("code")?.hasAttribute("data-deletions")
	)
		return "old";
	return "new";
};

const rowPoint = (
	rowEl: Element,
	diffStyle: "unified" | "split",
): GrabPoint => ({
	side: rowSide(rowEl, diffStyle),
	line: Number(rowEl.getAttribute("data-line")),
});

/** 같은 shadow root 안의 두 끝점 사이에 걸친 [data-line] 행들 (문서순). */
const rowsBetween = (root: ShadowRoot, a: Endpoint, b: Endpoint): Element[] => {
	const range = root.host.ownerDocument.createRange();
	range.setStart(a.node, a.offset);
	range.setEnd(b.node, b.offset);
	return [...root.querySelectorAll("[data-line]")].filter((el) =>
		range.intersectsNode(el),
	);
};

const allRows = (root: ShadowRoot): Element[] => [
	...root.querySelectorAll("[data-line]"),
];

/** split 크로스 컬럼: anchor 행의 code 컬럼 안에서 두 행 사이 구간을 클램프. */
const clampToColumn = (
	anchorRow: Element,
	first: Element,
	last: Element,
): Element[] => {
	const code = anchorRow.closest("code");
	if (!code) return [anchorRow];
	const range = anchorRow.ownerDocument.createRange();
	range.setStartBefore(first);
	range.setEndAfter(last);
	const rows = [...code.querySelectorAll("[data-line]")].filter((el) =>
		range.intersectsNode(el),
	);
	return rows.length > 0 ? rows : [anchorRow];
};

const buildTarget = (
	fileId: string,
	rowStart: Element,
	rowEnd: Element,
	backward: boolean,
	diffStyle: "unified" | "split",
	chars?: CharSpan,
): TextGrabTarget => {
	const pStart = rowPoint(rowStart, diffStyle);
	const pEnd = rowPoint(rowEnd, diffStyle);
	if (pStart.side === pEnd.side) {
		return {
			fileId,
			range: {
				kind: "side",
				side: pStart.side,
				startLine: Math.min(pStart.line, pEnd.line),
				endLine: Math.max(pStart.line, pEnd.line),
				...(chars ? { chars } : {}),
			},
		};
	}
	if (diffStyle === "split") {
		// 컬럼 클램프 — 문자 오프셋의 의미가 사라진다
		const anchorRow = backward ? rowEnd : rowStart;
		const clamped = clampToColumn(anchorRow, rowStart, rowEnd);
		const points = clamped.map((el) => rowPoint(el, diffStyle));
		const lines = points.map((p) => p.line);
		return {
			fileId,
			range: {
				kind: "side",
				side: rowSide(anchorRow, diffStyle),
				startLine: Math.min(...lines),
				endLine: Math.max(...lines),
			},
		};
	}
	return {
		fileId,
		range: {
			kind: "mixed",
			start: pStart,
			end: pEnd,
			...(chars ? { chars } : {}),
		},
	};
};

export const resolveTextTarget = (
	resolved: ResolvedSelection,
	diffStyle: "unified" | "split",
): TextGrabTarget | null => {
	const { range, backward }: { range: RangeEndpoints; backward: boolean } =
		resolved;
	const start = classify(range.startContainer, range.startOffset);
	const end = classify(range.endContainer, range.endOffset);
	if (!start && !end) return null;

	// 같은 파일 root 안에 양 끝점이 있는 경우
	if (start && end && start.root === end.root) {
		let rowStart = start.rowEl;
		let rowEnd = end.rowEl;
		if (!rowStart || !rowEnd) {
			const rows = rowsBetween(start.root, start, end);
			if (rows.length === 0) return null;
			rowStart ??= rows[0];
			rowEnd ??= rows[rows.length - 1];
		}
		// 두 끝점이 행 안에 직접 떨어졌고 클램프가 없었을 때만 문자 범위를 세운다.
		// getComposedRanges의 start/end는 문서순이므로 방향 정규화가 따로 필요 없다.
		let chars: CharSpan | undefined;
		if (
			start.direct &&
			end.direct &&
			rowStart === start.rowEl &&
			rowEnd === end.rowEl
		) {
			const a = charOffsetInRow(rowStart, start.node, start.offset);
			const b = charOffsetInRow(rowEnd, end.node, end.offset);
			if (a !== null && b !== null) chars = { start: a, end: b };
		}
		return buildTarget(
			start.fileId,
			rowStart,
			rowEnd,
			backward,
			diffStyle,
			chars,
		);
	}

	// 크로스 파일(양쪽 유효) 또는 한쪽만 유효 → 소유 파일 확정 + 방향 클램프
	const anchorEp = backward ? end : start;
	const owner = start && end ? anchorEp : (start ?? end);
	if (!owner?.rowEl) return null;
	const rows = allRows(owner.root);
	const ownerIsStart = owner === start;
	const rowStart = ownerIsStart ? owner.rowEl : rows[0];
	const rowEnd = ownerIsStart ? rows[rows.length - 1] : owner.rowEl;
	return buildTarget(owner.fileId, rowStart, rowEnd, backward, diffStyle);
};
