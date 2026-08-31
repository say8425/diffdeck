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

	// 이미지·바이너리는 hunk가 없다. 0을 보태고 조용히 지나가야 한다 —
	// 여기서 터지면 이미지가 하나 섞인 diff마다 툴바가 죽는다.
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
		// 구분자는 삭제 쪽이 품고 온다 — 조각 사이에 공백 텍스트 노드를
		// 만들지 않으려는 것으로, #picker-branch와 같은 관례다.
		expect(v.deletions).toBe(" -435");
	});

	// git·GitHub이 그렇듯 한쪽이 0이어도 둘 다 말한다 — "삭제가 없었다"는
	// 것도 정보이고, 자리가 사라지면 옆 숫자가 무엇인지 흔들린다.
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

	// 이미지만 바뀐 diff. 파일은 있는데 센 줄이 없으므로 `+0 -0`을 쓰면
	// 아무 말도 아닌 숫자가 툴바를 차지한다.
	test("센 줄이 하나도 없으면 아무 말도 하지 않는다", () => {
		expect(changeTotalsView([{ hunks: [] }])).toEqual({
			additions: "",
			deletions: "",
		});
	});

	test("파일 목록이 비면 아무 말도 하지 않는다", () => {
		expect(changeTotalsView([])).toEqual({ additions: "", deletions: "" });
	});

	// 자릿수 구분자를 넣지 않는다 — #status의 "176 file(s)"도, 엔진이 파일
	// 헤더에 그리는 배지도 생 숫자다. 한 화면에서 표기가 갈리면 안 된다.
	test("천 단위 구분자를 넣지 않는다", () => {
		expect(changeTotalsView([file(1234567, 0)]).additions).toBe("+1234567");
	});
});
