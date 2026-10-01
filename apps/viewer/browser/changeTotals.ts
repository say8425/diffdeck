// hunk의 숫자 필드를 센다. `FileDiffMetadata`의 같은 이름 필드는 파일 전체
// 내용(string[])이다(.claude/rules/viewer.md).
import type { Hunk } from "@diffdeck/diffs";

// 구분자는 삭제 쪽 텍스트가 품는다 — 마크업의 span 사이에 공백 노드를 두지
// 않는다.
const SEPARATOR = " ";

interface HunkCounts {
	hunks: readonly Pick<Hunk, "additionLines" | "deletionLines">[];
}

export interface ChangeTotals {
	additions: number;
	deletions: number;
}

export interface ChangeTotalsView {
	additions: string;
	deletions: string;
}

export const sumChangeTotals = (files: readonly HunkCounts[]): ChangeTotals => {
	let additions = 0;
	let deletions = 0;
	for (const file of files) {
		for (const hunk of file.hunks) {
			additions += hunk.additionLines;
			deletions += hunk.deletionLines;
		}
	}
	return { additions, deletions };
};

export const changeTotalsView = (
	files: readonly HunkCounts[],
): ChangeTotalsView => {
	const { additions, deletions } = sumChangeTotals(files);
	// 이미지만 바뀐 diff처럼 센 줄이 없으면 `+0 -0` 대신 자리를 비운다.
	if (additions === 0 && deletions === 0)
		return { additions: "", deletions: "" };
	// 한쪽이 0이어도 둘 다 쓴다 — 하나만 남으면 추가인지 삭제인지 색으로만 갈린다.
	return {
		additions: `+${additions}`,
		deletions: `${SEPARATOR}-${deletions}`,
	};
};
