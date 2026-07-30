// SelectedLineRange(엔진 거터 선택의 원시 형태)를 grab 파이프라인의 정규형으로.
// 같은 side면 min/max로 정렬(역방향 드래그 흡수), side가 다르면 mixed로 보존
// (시각 순서 결정은 snippet.ts의 행 워크가 담당).
import type { SelectedLineRange } from "@diffdeck/diffs";

export type GrabSide = "old" | "new";

export interface GrabPoint {
	side: GrabSide;
	line: number;
}

/**
 * 텍스트 드래그의 문자 범위. `start`는 범위 첫 행 텍스트 내 시작 오프셋,
 * `end`는 마지막 행 텍스트 내 끝 오프셋(exclusive)이다. 한 행이면 같은 행에서
 * start..end다. **없으면 줄 전체** — 거터 "+" 경로와 클램프된 선택이 그렇다.
 */
export interface CharSpan {
	start: number;
	end: number;
}

export type NormalizedRange =
	| {
			kind: "side";
			side: GrabSide;
			startLine: number;
			endLine: number;
			chars?: CharSpan;
	  }
	| { kind: "mixed"; start: GrabPoint; end: GrabPoint; chars?: CharSpan };

const toGrabSide = (side: "deletions" | "additions" | undefined): GrabSide =>
	side === "deletions" ? "old" : "new";

export const normalizeRange = (range: SelectedLineRange): NormalizedRange => {
	const startSide = toGrabSide(range.side);
	const endSide = toGrabSide(range.endSide ?? range.side);
	if (startSide === endSide) {
		return {
			kind: "side",
			side: startSide,
			startLine: Math.min(range.start, range.end),
			endLine: Math.max(range.start, range.end),
		};
	}
	return {
		kind: "mixed",
		start: { side: startSide, line: range.start },
		end: { side: endSide, line: range.end },
	};
};
