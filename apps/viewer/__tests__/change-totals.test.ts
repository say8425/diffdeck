import { describe, expect, test } from "bun:test";
import { changeTotalsView, sumChangeTotals } from "../browser/changeTotals.ts";

const file = (additionLines: number, deletionLines: number) => ({
	hunks: [{ additionLines, deletionLines }],
});

describe("sumChangeTotals", () => {
	test("한 파일의 hunk를 합한다", () => {
		expect(
			sumChangeTotals([
				{
					hunks: [
						{ additionLines: 3, deletionLines: 1 },
						{ additionLines: 4, deletionLines: 0 },
					],
				},
			]),
		).toEqual({ additions: 7, deletions: 1 });
	});

	test("여러 파일을 가로질러 합한다", () => {
		expect(sumChangeTotals([file(10, 2), file(5, 3), file(1, 0)])).toEqual({
			additions: 16,
			deletions: 5,
		});
	});

	// 이미지·바이너리 파일은 hunk가 없다.
	test("hunk가 없는 파일은 0을 보탠다", () => {
		expect(sumChangeTotals([file(4, 1), { hunks: [] }])).toEqual({
			additions: 4,
			deletions: 1,
		});
	});

	test("파일이 없으면 0", () => {
		expect(sumChangeTotals([])).toEqual({ additions: 0, deletions: 0 });
	});
});

describe("changeTotalsView", () => {
	test("추가와 삭제를 각자의 자리에 넣는다", () => {
		const v = changeTotalsView([file(17022, 435)]);
		expect(v.additions).toBe("+17022");
		// 구분 공백은 삭제 조각이 품는다 — span 사이에 공백 텍스트 노드를 두지
		// 않는다(viewer-toolbar.md).
		expect(v.deletions).toBe(" -435");
	});

	// 한쪽 자리가 사라지면 남은 숫자가 추가인지 삭제인지 색으로만 갈린다.
	test("한쪽이 0이어도 둘 다 말한다", () => {
		expect(changeTotalsView([file(5, 0)])).toEqual({
			additions: "+5",
			deletions: " -0",
		});
		expect(changeTotalsView([file(0, 9)])).toEqual({
			additions: "+0",
			deletions: " -9",
		});
	});

	// 이미지만 바뀐 diff에서 `+0 -0`은 아무 정보가 없는 숫자다.
	test("센 줄이 하나도 없으면 아무 말도 하지 않는다", () => {
		expect(changeTotalsView([{ hunks: [] }])).toEqual({
			additions: "",
			deletions: "",
		});
	});

	test("파일 목록이 비면 아무 말도 하지 않는다", () => {
		expect(changeTotalsView([])).toEqual({ additions: "", deletions: "" });
	});

	// #status와 파일 헤더 배지도 생 숫자다 — 한 화면에서 표기가 갈리지 않게 한다.
	test("천 단위 구분자를 넣지 않는다", () => {
		expect(changeTotalsView([file(1234567, 0)]).additions).toBe("+1234567");
	});
});
