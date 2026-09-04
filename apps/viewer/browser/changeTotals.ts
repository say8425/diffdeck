/**
 * 툴바의 전체 변경량 표식 — 개수(`#status`) 오른쪽에서 "이번 diff가 통틀어
 * 몇 줄을 더하고 지웠는가"를 말한다.
 *
 * 파일 수만으로는 규모를 못 읽는다: 176 file(s)가 문구 한 줄씩 고친 것인지
 * 통째로 새로 쓴 것인지 열어 보기 전에는 알 수 없다.
 *
 * 세는 값은 `largeFile.ts`의 `countChangedLines`와 **같은 출처**다 — hunk의
 * 숫자 필드다. `FileDiffMetadata`에도 동명의 `additionLines`/`deletionLines`가
 * 있지만 그건 `string[]`이고 뷰어처럼 파일 전량으로 파싱한 diff에서는 새/옛
 * 파일의 **전체 내용**이라, 세면 변경량이 아니라 파일 길이가 나온다(그 착각이
 * 실제로 대형 파일 자동 접힘을 오작동시킨 적이 있다 — CLAUDE.md).
 */
import type { Hunk } from "@diffdeck/diffs";

/** 조각 구분자. 삭제 쪽 텍스트가 품고 온다(`#picker-branch`와 같은 관례). */
const SEPARATOR = " ";

interface HunkCounts {
	hunks: readonly Pick<Hunk, "additionLines" | "deletionLines">[];
}

export interface ChangeTotals {
	additions: number;
	deletions: number;
}

/** 화면 각 자리에 그대로 들어가는 문자열들. 조립은 전부 이 모듈이 끝낸다. */
export interface ChangeTotalsView {
	/** `#change-add`의 텍스트(`"+17022"`). 셀 것이 없으면 빈 문자열. */
	additions: string;
	/** `#change-del`의 텍스트. 구분자를 품는다(`" -435"`). 없으면 빈 문자열. */
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
	// 이미지만 바뀐 diff는 파일이 있어도 센 줄이 없다. `+0 -0`을 쓰면 아무
	// 말도 아닌 숫자가 툴바를 차지하므로 그때는 자리를 통째로 비운다.
	if (additions === 0 && deletions === 0)
		return { additions: "", deletions: "" };
	// 한쪽이 0이어도 둘 다 말한다 — git·GitHub과 같고, 자리가 사라지면 남은
	// 숫자가 추가인지 삭제인지 색에만 의존하게 된다.
	return {
		additions: `+${additions}`,
		deletions: `${SEPARATOR}-${deletions}`,
	};
};
