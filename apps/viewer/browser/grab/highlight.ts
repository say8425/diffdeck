// grab 전용 CSS Custom Highlight 채널. 엔진의 selectedLines 슬롯(= find 바가
// 매치 하이라이트에 쓰는 슬롯)을 건드리지 않는 독립 채널이라, 텍스트 드래그가
// find 하이라이트를 지우지 않고 grabOwnsLineSelection 불변식도 유지된다.
// 스타일은 main.ts의 unsafeCSS로 shadow root에 들어간다 — 앱이 직접 shadow
// root에 <style>을 붙이면 CodeView.cleanElement()가 첫 recycle에 떼어낸다
// (isPooledShadowChild는 data-unsafe-css 등을 단 style 노드만 보존).
// 파사드가 덕타입인 이유: happy-dom엔 CSS.highlights도 Highlight도 없어,
// 100% 커버리지 게이트 안에서 전 분기를 덮으려면 실 DOM 타입에 묶이면 안 된다.
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
	/** rowSide(el, diffStyle) — 이 행이 어느 컬럼/타입에 속하는가. */
	side: GrabSide;
	/** data-line — 그 행 자기 side의 라인 번호. */
	line: number;
	/** data-alt-line — 반대편 번호. 엔진은 context 행에만 stamp한다. */
	altLine: number | null;
}

/**
 * 이 행이 요청한 side의 몇 번 줄을 대표하는가 (아니면 null).
 *
 * unified의 context 행은 엔진이 addition 요소 하나로만 렌더하므로 data-line이
 * new 번호다 — 그래서 old 스트림도 이 행이 대표하고, 그 번호는 data-alt-line에
 * 있다. 이 폴백이 없으면 old-side 범위에서 사이의 context 행이 하이라이트에서만
 * 빠져(클립보드에는 들어간다 — snippet.ts가 deletionLines를 통째로 슬라이스한다)
 * "보이는 범위 == 복사되는 범위"가 깨진다.
 *
 * split은 context 행을 컬럼마다 하나씩 따로 렌더하므로 폴백을 허용하면 old
 * 범위가 additions 컬럼의 context 행까지 물들인다 → unified로 한정한다.
 */
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

/** 칠할 대상 한 줄. start/end가 없으면 그 행 전체다. */
export interface PaintTarget {
	el: Element;
	start?: number;
	end?: number;
}

/**
 * 첫 hit에 start, 끝 hit에 end를 붙인다 — 단 그 hit이 실제로 선택의 경계
 * 행일 때만(startExact/endExact). `hits`는 그 순간 렌더된 행만 담으므로,
 * 선택 경계 행이 렌더 윈도우 밖이면 보이는 첫/끝 행은 선택의 중간일 뿐이다.
 * 그런 행에 chars를 붙이면 선택하지 않은 지점이 잘려나가 보인다 — 이 작업의
 * 출발점이 된 버그가 형태만 바꿔 재현되므로, 경계가 안 보이면 그 행 전체를
 * 오프셋 없이 둔다(호출부가 이미 있는 lineFor/indexOfPoint 결과로 판정한다).
 */
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

/**
 * 문서순 행 목록에서 범위에 드는 행만 고른다.
 *
 * side kind는 술어 필터라 가상화 잘림에 자연히 강하다(보이는 행만 매치).
 * mixed kind는 문서순 인덱스로 자른다 — 크로스 사이드는 old/new 번호 체계가
 * 달라 번호 대소 비교가 순서를 뒤집을 수 있다. 한쪽 끝점만 렌더돼 있으면
 * 그 방향으로 클램프하고, 둘 다 없으면 아무것도 칠하지 않는다.
 *
 * mixed + split은 원천 차단한다: split의 행 목록은 컬럼별로 통째로 묶여
 * 나온다(deletions 컬럼 전부 → additions 컬럼 전부) — 문서순 슬라이스가
 * 컬럼 경계를 넘으면 그럴듯하지만 틀린 범위(반대 컬럼의 무관한 구간)를
 * 칠하게 된다. 현재는 도달 불가한 조합이다: 텍스트 드래그 경로는 split
 * 크로스사이드를 이미 side range로 접고(textSelection.ts:117-129의
 * clampToColumn), 거터 경로(range.ts:20-36의 normalizeRange)는 split에서도
 * mixed를 만들 수 있지만 grab 하이라이트 채널을 쓰지 않는다(main.ts 배선의
 * 불변식). 그 불변식이 깨져 이 조합이 실제로 들어오면 배선 버그이고, 그때도
 * 그럴듯하게 잘못된 영역을 칠하기보다 아무것도 칠하지 않는 쪽이 안전하다.
 */
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
		// 보이는 첫/끝 hit이 실제로 선택의 startLine/endLine과 일치할 때만
		// 경계로 인정한다 — 렌더 윈도우가 좁아 경계 행이 안 보이면 다르다.
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
	// i/j 음수는 "그 끝점이 렌더 윈도우에 없다"는 뜻 — 딱 우리가 원하는 경계
	// 판정 조건이다(from/to로 클램프된 값이 아니라 원래 인덱스로 판정한다).
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

/**
 * 행 텍스트 기준 오프셋을 (텍스트 노드, 노드 내 오프셋)으로 변환한다.
 * 워커 재하이라이트로 span 구조가 바뀌어도 행의 텍스트 자체는 동일하므로
 * 재시딩 때 다시 찾을 수 있다.
 */
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
				// 오프셋이 현재 DOM과 맞지 않으면 그 행 전체를 칠한다 —
				// 아무것도 안 칠하는 것보다 낫다.
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
