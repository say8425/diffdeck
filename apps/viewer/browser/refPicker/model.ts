/**
 * 피커가 보여줄 "무엇과 견줄까" 목록의 순수 로직.
 *
 * DOM도 fetch도 모르므로 유닛으로 전부 덮인다 — 배선만 main.ts에 남는다.
 */
import type { RefRecord } from "../../server/refs.ts";

export interface BaseRow {
	/** `base=` 쿼리에 실릴 값. */
	value: string;
	/** 화면에 보이는 이름. */
	label: string;
	kind: "working" | "local" | "remote";
	/** 오른쪽에 붙는 맥락 표시. */
	tag: "default" | "HEAD" | null;
}

/**
 * 아직 커밋하지 않은 변경만 보는 선택. `merge-base(HEAD, HEAD) === HEAD`라서
 * 서버에 특별한 분기 없이 오늘의 워킹트리 뷰와 같은 결과가 된다.
 */
const WORKING_ROW: BaseRow = {
	value: "HEAD",
	label: "Working tree",
	kind: "working",
	tag: null,
};

export const buildBaseRows = (
	refs: readonly RefRecord[],
	defaultBranch: string | null,
	currentBranch: string | null,
): BaseRow[] => {
	const toRow = (r: RefRecord): BaseRow => ({
		value: r.name,
		label: r.name,
		kind: r.kind,
		// 자기 자신과 견주면 언제나 비어 보인다. 막지는 않되 왜 그런지
		// 읽히도록 표시한다 — 조용한 빈 화면이 이 기능의 가장 큰 위험이다.
		tag:
			r.name === defaultBranch
				? "default"
				: r.name === currentBranch
					? "HEAD"
					: null,
	});
	// 로컬을 먼저, 원격을 뒤로. 각 무리 안에서는 받은 순서를 그대로 둔다.
	return [
		WORKING_ROW,
		...refs.filter((r) => r.kind === "local").map(toRow),
		...refs.filter((r) => r.kind === "remote").map(toRow),
	];
};

export const filterBaseRows = (
	rows: readonly BaseRow[],
	query: string,
): BaseRow[] => {
	const needle = query.trim().toLowerCase();
	if (needle === "") return [...rows];
	return rows.filter((r) => r.label.toLowerCase().includes(needle));
};
