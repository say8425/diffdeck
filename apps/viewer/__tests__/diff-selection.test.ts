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

	// 알 수 없는 mode는 400이 아니라 working으로 떨어진다 — 링크가 깨지지 않는 쪽이다.
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
	// 키에는 flight 클로저가 읽는 입력이 빠짐없이 들어가야 한다 — 빠지면 다른 선택이 같은 슬롯에 합류해 남의 diff를 받는다.
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

	// 중복처럼 보여도 지우지 않는다: 커밋 없는 리포에서 참조 검증이 실패하고, prewarm이 데운 슬롯과 키가 갈린다(server.md).
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

	test("a chosen ref ignores the server-resolved base", () => {
		const sel = parseSelection(params("repo=/r&base=develop"));
		expect(selectionCacheKey(sel, "origin/main")).toBe(
			selectionCacheKey(sel, "origin/other"),
		);
	});

	test("a ref literally named auto is not the auto selector", () => {
		expect(
			selectionCacheKey(parseSelection(params("repo=/r&base=auto")), null),
		).not.toBe(
			selectionCacheKey(parseSelection(params("repo=/r&base=@auto")), null),
		);
	});
});

describe("parseSelection with an explicit head", () => {
	test("head is the working tree unless asked otherwise", () => {
		expect(parseSelection(new URLSearchParams("repo=/r")).head).toEqual({
			kind: "worktree",
		});
	});

	test("an empty head falls back to the working tree", () => {
		expect(parseSelection(new URLSearchParams("repo=/r&head=")).head).toEqual({
			kind: "worktree",
		});
	});

	test("head names a ref to view instead of the working tree", () => {
		expect(
			parseSelection(new URLSearchParams("repo=/r&head=feature/x")).head,
		).toEqual({ kind: "ref", ref: "feature/x" });
	});

	// base=HEAD와 달리 정규화하지 않는다 — head=HEAD는 커밋된 HEAD라 미커밋 변경이 빠진다.
	test("head=HEAD stays a ref — it is not the working tree", () => {
		expect(
			parseSelection(new URLSearchParams("repo=/r&head=HEAD")).head,
		).toEqual({ kind: "ref", ref: "HEAD" });
	});

	test("head and base are independent axes", () => {
		const sel = parseSelection(
			new URLSearchParams("repo=/r&base=main&head=dev"),
		);
		expect(sel.base).toEqual({ kind: "ref", ref: "main" });
		expect(sel.head).toEqual({ kind: "ref", ref: "dev" });
	});
});

describe("selectionCacheKey with an explicit head", () => {
	const sel = (query: string) => parseSelection(new URLSearchParams(query));

	test("separates a worktree head from a ref head", () => {
		expect(selectionCacheKey(sel("repo=/r"), null)).not.toBe(
			selectionCacheKey(sel("repo=/r&head=dev"), null),
		);
	});

	test("separates two different ref heads", () => {
		expect(selectionCacheKey(sel("repo=/r&head=dev"), null)).not.toBe(
			selectionCacheKey(sel("repo=/r&head=main"), null),
		);
	});

	test("the same head lands on the same slot", () => {
		expect(selectionCacheKey(sel("repo=/r&head=dev"), null)).toBe(
			selectionCacheKey(sel("repo=/r&head=dev"), null),
		);
	});

	// 곧이곧대로 답하면 `git diff <rev> <rev>`가 되어 에러 없이 빈 화면이 된다.
	test("a rev head with a working-tree base resolves to auto", () => {
		for (const q of [
			"head=feat",
			"head=feat&base=HEAD",
			"head=feat&mode=working",
		]) {
			const sel = parseSelection(new URLSearchParams(q));
			expect(sel.base).toEqual({ kind: "auto" });
			expect(sel.head).toEqual({ kind: "ref", ref: "feat" });
		}
	});

	test("an explicit base ref survives alongside a head", () => {
		const sel = parseSelection(new URLSearchParams("head=feat&base=develop"));
		expect(sel.base).toEqual({ kind: "ref", ref: "develop" });
	});

	test("a worktree head keeps the working-tree base", () => {
		expect(parseSelection(new URLSearchParams("")).base).toEqual({
			kind: "head",
		});
	});
});
