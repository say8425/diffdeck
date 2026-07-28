// SelectedLineRange(엔진 거터 선택의 원시 형태)를 grab 파이프라인의 정규형으로.
// 같은 side면 min/max로 정렬(역방향 드래그 흡수), side가 다르면 mixed로 보존
// (시각 순서 결정은 snippet.ts의 행 워크가 담당).
import type { SelectedLineRange } from "@diffdeck/diffs";

export type GrabSide = "old" | "new";

export interface GrabPoint {
	side: GrabSide;
	line: number;
}

export type NormalizedRange =
	| { kind: "side"; side: GrabSide; startLine: number; endLine: number }
	| { kind: "mixed"; start: GrabPoint; end: GrabPoint };

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
