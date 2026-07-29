import { describe, expect, test } from "bun:test";
import { normalizeRange } from "../browser/grab/range.ts";

describe("normalizeRange", () => {
	test("same-side forward drag → side kind, 그대로", () => {
		expect(normalizeRange({ start: 3, end: 7, side: "additions" })).toEqual({
			kind: "side",
			side: "new",
			startLine: 3,
			endLine: 7,
		});
	});
	test("역방향 드래그(start > end) → min/max 정규화", () => {
		expect(normalizeRange({ start: 9, end: 4, side: "deletions" })).toEqual({
			kind: "side",
			side: "old",
			startLine: 4,
			endLine: 9,
		});
	});
	test("side 생략 → 엔진 기본 additions('new')", () => {
		expect(normalizeRange({ start: 2, end: 2 })).toEqual({
			kind: "side",
			side: "new",
			startLine: 2,
			endLine: 2,
		});
	});
	test("endSide만 다르면 mixed, 끝점 순서 보존", () => {
		expect(
			normalizeRange({
				start: 10,
				side: "deletions",
				end: 12,
				endSide: "additions",
			}),
		).toEqual({
			kind: "mixed",
			start: { side: "old", line: 10 },
			end: { side: "new", line: 12 },
		});
	});
	test("endSide 생략 시 side를 따라감(mixed 아님)", () => {
		expect(normalizeRange({ start: 5, end: 1, side: "deletions" }).kind).toBe(
			"side",
		);
	});
});
