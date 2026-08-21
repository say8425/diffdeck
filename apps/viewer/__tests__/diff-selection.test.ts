import { describe, expect, test } from "bun:test";
import { parseSelection, selectionCacheKey } from "../server/selection.ts";

const params = (query: string): URLSearchParams => new URLSearchParams(query);

describe("parseSelection", () => {
	test("defaults to the head base when mode is absent", () => {
		expect(parseSelection(params("repo=/r")).base).toEqual({ kind: "head" });
	});

	test("mode=base selects the auto-resolved base", () => {
		expect(parseSelection(params("repo=/r&mode=base")).base).toEqual({
			kind: "auto",
		});
	});

	test("mode=working selects the head base", () => {
		expect(parseSelection(params("repo=/r&mode=working")).base).toEqual({
			kind: "head",
		});
	});

	// 오늘의 삼항(=== "base" ? ... : "working")과 같은 관용: 알 수 없는 값은
	// 400이 아니라 조용히 working으로 떨어진다. 링크가 깨지지 않는 쪽이다.
	test("an unknown mode falls back to the head base", () => {
		expect(parseSelection(params("repo=/r&mode=nonsense")).base).toEqual({
			kind: "head",
		});
	});

	test("untracked is on only for the exact string 1", () => {
		expect(parseSelection(params("repo=/r&untracked=1")).untracked).toBe(true);
		expect(parseSelection(params("repo=/r&untracked=true")).untracked).toBe(
			false,
		);
		expect(parseSelection(params("repo=/r")).untracked).toBe(false);
	});

	test("a missing repo becomes the empty string, as the routes expect", () => {
		expect(parseSelection(params("")).repo).toBe("");
	});
});

describe("selectionCacheKey", () => {
	// 이 스위트가 지키는 진짜 계약: 키는 flight 클로저가 읽는 모든 입력의
	// 전함수여야 한다. 오늘 diffFlight의 클로저는 repo·untracked·mode·ref를
	// 읽는데 키에는 ref가 없어서, 해석된 base가 바뀐 두 요청이 같은 키로
	// 합류하면 한쪽이 남의 ref로 만든 diff를 받는다.
	test("distinguishes two auto selections whose base resolved differently", () => {
		const sel = parseSelection(params("repo=/r&mode=base"));
		expect(selectionCacheKey(sel, "origin/main")).not.toBe(
			selectionCacheKey(sel, "origin/develop"),
		);
	});

	test("ignores the resolved ref when the base is head", () => {
		const sel = parseSelection(params("repo=/r&mode=working"));
		expect(selectionCacheKey(sel, "origin/main")).toBe(
			selectionCacheKey(sel, "origin/develop"),
		);
	});

	test("separates repo, untracked and base kind", () => {
		const keys = new Set([
			selectionCacheKey(parseSelection(params("repo=/a&mode=working")), null),
			selectionCacheKey(parseSelection(params("repo=/b&mode=working")), null),
			selectionCacheKey(
				parseSelection(params("repo=/a&mode=working&untracked=1")),
				null,
			),
			selectionCacheKey(parseSelection(params("repo=/a&mode=base")), null),
		]);
		expect(keys.size).toBe(4);
	});

	// 경로·refname에 구분자가 섞여도 서로 다른 선택이 같은 키로 뭉개지지
	// 않아야 한다 (NUL은 두 값 어디에도 들어갈 수 없다).
	test("does not collide when a repo path contains the separator's neighbours", () => {
		expect(
			selectionCacheKey(parseSelection(params("repo=/a%00false")), null),
		).not.toBe(selectionCacheKey(parseSelection(params("repo=/a")), null));
	});
});
