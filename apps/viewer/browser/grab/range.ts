import type { SelectedLineRange } from "@diffdeck/diffs";

export type GrabSide = "old" | "new";

export interface GrabPoint {
	side: GrabSide;
	line: number;
}

/**
 * `start`는 첫 행 안의 시작 오프셋, `end`는 마지막 행 안의 끝 오프셋
 * (exclusive). 없으면 줄 전체다.
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

// side가 다르면 순서를 정하지 않고 mixed로 둔다 — 시각 순서는 snippet.ts가
// 행을 걸으며 정한다.
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
