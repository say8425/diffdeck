/**
 * 피커가 보여줄 "무엇과 견줄까" 목록의 순수 로직.
 *
 * DOM도 fetch도 모르므로 유닛으로 전부 덮인다 — 배선만 main.ts에 남는다.
 */
import type { RefRecord } from "../../server/refs.ts";

/** 목록의 두 구역. 종류가 다르다는 것을 화면에서 가르는 근거다. */
export type RowSection = "uncommitted" | "branches";

export interface BaseRow {
	/** `base=` 쿼리에 실릴 값. */
	value: string;
	/** 화면에 보이는 이름. */
	label: string;
	kind: "working" | "local" | "remote";
	section: RowSection;
	/** 맥락 표시. note에 합쳐져 오른쪽에 붙는다. */
	tag: "default" | "HEAD" | null;
	/** 행 오른쪽 보조 텍스트. 모르는 것은 지어내지 않으므로 null일 수 있다. */
	note: string | null;
}

/**
 * 서버가 **이미 아는** 개수만 담는다. /api/summary가 매 로드마다 계산하는
 * 값이라 git 호출이 늘지 않는다. 브랜치마다 개수를 붙이려면 브랜치당 호출이
 * 하나씩 더 들기 때문에, 여기 없는 행에는 숫자를 쓰지 않는다.
 */
export interface RowCounts {
	/** 미커밋 변경 파일 수. 모르면 null. */
	working: number | null;
	/** 그 개수가 측정된 비교 대상과 파일 수. */
	base: { name: string; files: number } | null;
}

const files = (n: number): string => `${n} file(s)`;

/**
 * 아직 커밋하지 않은 변경만 보는 선택. `merge-base(HEAD, HEAD) === HEAD`라서
 * 서버에 특별한 분기 없이 오늘의 워킹트리 뷰와 같은 결과가 된다.
 */
const WORKING_VALUE = "HEAD";

export const buildBaseRows = (
	refs: readonly RefRecord[],
	defaultBranch: string | null,
	currentBranch: string | null,
	counts?: RowCounts,
): BaseRow[] => {
	// 0을 "nothing yet"으로 쓰는 이유: 숫자 0은 훑어볼 때 눈에 안 걸리는데,
	// 이 행이 비어 있다는 사실이야말로 고르기 전에 알아야 하는 것이다.
	const workingNote =
		counts?.working == null
			? null
			: counts.working === 0
				? "nothing yet"
				: files(counts.working);

	const workingRow: BaseRow = {
		value: WORKING_VALUE,
		label: "Working tree",
		kind: "working",
		section: "uncommitted",
		tag: null,
		note: workingNote,
	};

	const toRow = (r: RefRecord): BaseRow => {
		// 자기 자신과 견주면 언제나 비어 보인다. 막지는 않되 왜 그런지
		// 읽히도록 표시한다 — 조용한 빈 화면이 이 기능의 가장 큰 위험이다.
		const tag =
			r.name === defaultBranch
				? "default"
				: r.name === currentBranch
					? "HEAD"
					: null;
		const measured =
			counts?.base && counts.base.name === r.name
				? files(counts.base.files)
				: null;
		const parts = [tag, measured].filter((s): s is string => s !== null);
		return {
			value: r.name,
			label: r.name,
			kind: r.kind,
			section: "branches",
			tag,
			note: parts.length > 0 ? parts.join(" · ") : null,
		};
	};

	// 로컬을 먼저, 원격을 뒤로. 각 무리 안에서는 받은 순서를 그대로 둔다.
	return [
		workingRow,
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
