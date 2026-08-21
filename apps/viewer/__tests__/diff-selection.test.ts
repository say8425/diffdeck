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

describe("parseSelection with an explicit base", () => {
	test("base names a ref to compare against", () => {
		expect(parseSelection(params("repo=/r&base=develop")).base).toEqual({
			kind: "ref",
			ref: "develop",
		});
	});

	test("the @auto sentinel asks the server to resolve the base itself", () => {
		expect(parseSelection(params("repo=/r&base=@auto")).base).toEqual({
			kind: "auto",
		});
	});

	// base가 있으면 mode는 무시된다 — 한 축을 두 파라미터가 인코딩하면
	// 서로 모순되는 상태가 생기므로, 새 파라미터가 이긴다는 규칙 하나로
	// 그 상태를 없앤다.
	test("an explicit base wins over the legacy mode", () => {
		expect(
			parseSelection(params("repo=/r&mode=working&base=develop")).base,
		).toEqual({ kind: "ref", ref: "develop" });
	});

	test("an empty base falls back to the legacy mode", () => {
		expect(parseSelection(params("repo=/r&base=&mode=base")).base).toEqual({
			kind: "auto",
		});
	});

	// 참조로 두지 않고 정규화한다: unborn HEAD 리포에서 참조 검증이 실패해
	// 첫 화면이 400이 되는 것을 막고, prewarm 슬롯과 캐시 키를 일치시킨다.
	test("base=HEAD normalizes to the head selector, not a ref named HEAD", () => {
		expect(parseSelection(params("repo=/r&base=HEAD")).base).toEqual({
			kind: "head",
		});
	});
});

describe("selectionCacheKey with an explicit base", () => {
	test("two different chosen refs never share a slot", () => {
		expect(
			selectionCacheKey(parseSelection(params("repo=/r&base=a")), null),
		).not.toBe(
			selectionCacheKey(parseSelection(params("repo=/r&base=b")), null),
		);
	});

	// 사용자가 고른 ref는 서버가 해석할 필요가 없으므로 해석값과 무관해야 한다.
	test("a chosen ref ignores the server-resolved base", () => {
		const sel = parseSelection(params("repo=/r&base=develop"));
		expect(selectionCacheKey(sel, "origin/main")).toBe(
			selectionCacheKey(sel, "origin/other"),
		);
	});

	// 고른 ref "auto"와 자동 해석은 서로 다른 질문이다.
	test("a ref literally named auto is not the auto selector", () => {
		expect(
			selectionCacheKey(parseSelection(params("repo=/r&base=auto")), null),
		).not.toBe(
			selectionCacheKey(parseSelection(params("repo=/r&base=@auto")), null),
		);
	});
});
