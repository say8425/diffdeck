// grab 전용 CSS Custom Highlight 채널(.claude/rules/grab.md). 의존성을 덕타입으로
// 받는 것은 happy-dom에 CSS.highlights도 Highlight도 없어서다.
import type {
	CharSpan,
	GrabPoint,
	GrabSide,
	NormalizedRange,
} from "./range.ts";

export const GRAB_HIGHLIGHT_NAME = "diffdeck-grab";

export type DiffStyle = "unified" | "split";

export interface GrabRow {
	el: Element;
	side: GrabSide;
	line: number;
	// data-alt-line. 엔진은 context 행에만 단다.
	altLine: number | null;
}

// unified의 context 행은 data-line이 new 번호라 old 쪽은 altLine으로 대표한다.
// split은 컬럼마다 context 행이 따로 있어 이 폴백을 쓰면 반대 컬럼까지 칠한다.
export const lineFor = (
	row: GrabRow,
	side: GrabSide,
	diffStyle: DiffStyle,
): number | null => {
	if (row.side === side) return row.line;
	if (diffStyle === "unified" && row.altLine !== null) return row.altLine;
	return null;
};

const indexOfPoint = (
	rows: readonly GrabRow[],
	point: GrabPoint,
	diffStyle: DiffStyle,
): number =>
	rows.findIndex((row) => lineFor(row, point.side, diffStyle) === point.line);

export interface PaintTarget {
	el: Element;
	start?: number;
	end?: number;
}

// 행은 렌더된 것만 들어온다. 선택의 경계 행이 렌더 윈도우 밖이면 보이는 첫/끝
// 행은 선택의 중간이므로 오프셋 없이 행 전체를 칠한다(startExact/endExact).
const withChars = (
	els: readonly Element[],
	chars: CharSpan | undefined,
	startExact: boolean,
	endExact: boolean,
): PaintTarget[] => {
	if (!chars || els.length === 0) return els.map((el) => ({ el }));
	if (els.length === 1) {
		return [
			{
				el: els[0],
				...(startExact ? { start: chars.start } : {}),
				...(endExact ? { end: chars.end } : {}),
			},
		];
	}
	return els.map((el, k) => {
		if (k === 0 && startExact) return { el, start: chars.start };
		if (k === els.length - 1 && endExact) return { el, end: chars.end };
		return { el };
	});
};

// mixed는 번호가 아니라 문서순 인덱스로 자른다 — old/new 번호 체계가 달라 대소
// 비교가 순서를 뒤집는다. mixed + split은 칠하지 않는다: split의 행 목록은
// 컬럼별로 묶여 있어 슬라이스가 반대 컬럼의 무관한 구간을 칠한다(지금은
// 도달하지 않는다 — 텍스트 경로는 split에서 side로 접고, 거터 경로는 이 채널을
// 쓰지 않는다).
export const rowsInRange = (
	rows: readonly GrabRow[],
	range: NormalizedRange,
	diffStyle: DiffStyle,
): PaintTarget[] => {
	if (range.kind === "side") {
		const hits: GrabRow[] = [];
		for (const row of rows) {
			const n = lineFor(row, range.side, diffStyle);
			if (n !== null && n >= range.startLine && n <= range.endLine)
				hits.push(row);
		}
		if (hits.length === 0) return [];
		const startExact =
			lineFor(hits[0], range.side, diffStyle) === range.startLine;
		const endExact =
			lineFor(hits[hits.length - 1], range.side, diffStyle) === range.endLine;
		return withChars(
			hits.map((row) => row.el),
			range.chars,
			startExact,
			endExact,
		);
	}
	if (diffStyle === "split") return [];
	const i = indexOfPoint(rows, range.start, diffStyle);
	const j = indexOfPoint(rows, range.end, diffStyle);
	if (i < 0 && j < 0) return [];
	const from = i < 0 ? 0 : i;
	const to = j < 0 ? rows.length - 1 : j;
	const hits = rows
		.slice(Math.min(from, to), Math.max(from, to) + 1)
		.map((row) => row.el);
	// 경계 판정은 클램프한 from/to가 아니라 원래 인덱스로 한다(음수 = 렌더
	// 윈도우 밖).
	return withChars(hits, range.chars, i >= 0, j >= 0);
};

export interface HighlightRegistryLike {
	set(name: string, value: unknown): void;
	delete(name: string): void;
}

export interface RangeLike {
	selectNodeContents(node: Node): void;
	setStart(node: Node, offset: number): void;
	setEnd(node: Node, offset: number): void;
}

export interface GrabHighlighterDeps {
	/** CSS.highlights — 미지원 브라우저에서는 null. */
	registry: HighlightRegistryLike | null;
	createHighlight(ranges: readonly RangeLike[]): unknown;
	createRange(): RangeLike;
}

export interface GrabHighlighter {
	paint(targets: readonly PaintTarget[]): void;
	clear(): void;
}

// 오프셋을 행 텍스트 기준으로 들고 다니는 것은 워커 재하이라이트로 span 구조가
// 바뀌어도 다시 찾기 위해서다.
const locateOffset = (
	rowEl: Element,
	charOffset: number,
): { node: Node; offset: number } | null => {
	const walker = rowEl.ownerDocument.createTreeWalker(
		rowEl,
		NodeFilter.SHOW_TEXT,
	);
	let acc = 0;
	let current = walker.nextNode();
	while (current !== null) {
		const len = (current as Text).data.length;
		if (acc + len >= charOffset)
			return { node: current, offset: charOffset - acc };
		acc += len;
		current = walker.nextNode();
	}
	return null;
};

export const createGrabHighlighter = (
	deps: GrabHighlighterDeps,
): GrabHighlighter => {
	const clear = (): void => {
		deps.registry?.delete(GRAB_HIGHLIGHT_NAME);
	};
	const paint = (targets: readonly PaintTarget[]): void => {
		const { registry } = deps;
		if (!registry) return;
		if (targets.length === 0) {
			clear();
			return;
		}
		const ranges = targets.map((target) => {
			const range = deps.createRange();
			if (target.start === undefined && target.end === undefined) {
				range.selectNodeContents(target.el);
				return range;
			}
			const total = target.el.textContent?.length ?? 0;
			const a = locateOffset(target.el, target.start ?? 0);
			const b = locateOffset(target.el, target.end ?? total);
			if (a === null || b === null) {
				range.selectNodeContents(target.el);
				return range;
			}
			range.setStart(a.node, a.offset);
			range.setEnd(b.node, b.offset);
			return range;
		});
		registry.set(GRAB_HIGHLIGHT_NAME, deps.createHighlight(ranges));
	};
	return { paint, clear };
};
