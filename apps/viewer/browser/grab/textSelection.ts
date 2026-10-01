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

// 행의 textContent는 원본 라인과 정확히 같아서(탭 포함, 삽입 문자 없음) 텍스트
// 노드 길이를 누적하면 원본 라인 기준 오프셋이 된다.
export const charOffsetInRow = (
	rowEl: Element,
	node: Node,
	offset: number,
): number | null => {
	// 끝점이 행 요소 자체면 offset은 자식 인덱스다.
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
		// 컬럼으로 클램프하면 문자 오프셋이 뜻을 잃어 chars를 싣지 않는다.
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

	if (start && end && start.root === end.root) {
		let rowStart = start.rowEl;
		let rowEnd = end.rowEl;
		if (!rowStart || !rowEnd) {
			const rows = rowsBetween(start.root, start, end);
			if (rows.length === 0) return null;
			rowStart ??= rows[0];
			rowEnd ??= rows[rows.length - 1];
		}
		// getComposedRanges의 start/end는 문서순이라 방향을 따로 맞추지 않는다.
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

	// 크로스 파일이면 앵커 쪽 파일, 한쪽 끝점만 파일 안이면 그 파일로 클램프한다.
	const anchorEp = backward ? end : start;
	const owner = start && end ? anchorEp : (start ?? end);
	if (!owner?.rowEl) return null;
	const rows = allRows(owner.root);
	const ownerIsStart = owner === start;
	const rowStart = ownerIsStart ? owner.rowEl : rows[0];
	const rowEnd = ownerIsStart ? rows[rows.length - 1] : owner.rowEl;
	return buildTarget(owner.fileId, rowStart, rowEnd, backward, diffStyle);
};
