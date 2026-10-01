import { describe, expect, test } from "bun:test";
import {
	chipMinWidth,
	PR_STATE_LABEL,
	prBranchOf,
	prChipView,
	prFor,
	prIconSvg,
	viewedPrBranch,
} from "../browser/prBadge.ts";
import type { PrRecord, PrState, PrsByBranch } from "../server/prs.ts";
import type { RefRecord } from "../server/refs.ts";

const STATES: PrState[] = ["open", "draft", "merged", "closed"];

const record = (over: Partial<PrRecord> = {}): PrRecord => ({
	number: 85,
	title: "feat: diff 로드 실패 카드가 이유를 말한다",
	state: "open",
	url: "https://github.com/o/r/pull/85",
	...over,
});

describe("prIconSvg", () => {
	// 상태는 글자로 되풀이하지 않는다 — 아이콘이 보조기술에 상태를 말해야 한다.
	test.each(STATES)("%s speaks its state to assistive tech", (state) => {
		const svg = prIconSvg(state, 14);
		expect(svg).toContain('role="img"');
		expect(svg).toContain(`aria-label="${PR_STATE_LABEL[state]}"`);
		expect(svg).toContain(`data-state="${state}"`);
		expect(svg).toContain('width="14"');
		expect(svg).not.toContain("aria-hidden");
	});

	// 색을 못 가리는 사람도 구별할 수 있어야 한다.
	test("every state has its own shape", () => {
		const shapes = STATES.map((s) =>
			prIconSvg(s, 14).replace(/<svg[^>]*>/, ""),
		);
		expect(new Set(shapes).size).toBe(4);
	});

	test("labels say which kind of pull request", () => {
		expect(Object.values(PR_STATE_LABEL)).toEqual([
			"Open pull request",
			"Draft pull request",
			"Merged pull request",
			"Closed pull request",
		]);
	});
});

describe("prBranchOf", () => {
	test("a local branch is its own PR head", () => {
		expect(prBranchOf("feat/x", "local")).toBe("feat/x");
	});
	test("a remote branch drops its remote name", () => {
		expect(prBranchOf("origin/feat/x", "remote")).toBe("feat/x");
	});
});

describe("viewedPrBranch", () => {
	const refs: RefRecord[] = [
		{ name: "fix/foo", kind: "local", worktreePath: null },
		{ name: "origin/feat/x", kind: "remote", worktreePath: null },
	];

	test("the worktree's branch when no head is chosen", () => {
		expect(viewedPrBranch(null, "main", refs)).toBe("main");
		expect(viewedPrBranch(null, null, refs)).toBeNull();
	});

	test("a remote head drops its remote name", () => {
		expect(viewedPrBranch("origin/feat/x", "main", refs)).toBe("feat/x");
	});

	// 이름만 보고 첫 세그먼트를 벗기면 로컬 `fix/foo`가 `foo`의 PR을 단다.
	test("a local head with a slash keeps its whole name", () => {
		expect(viewedPrBranch("fix/foo", "main", refs)).toBe("fix/foo");
	});

	test("head=HEAD means the worktree's branch", () => {
		expect(viewedPrBranch("HEAD", "feat/x", refs)).toBe("feat/x");
	});

	test("a head not in the list yet is taken as is", () => {
		expect(viewedPrBranch("feat/y", "main", [])).toBe("feat/y");
	});
});

describe("prFor", () => {
	const prs: PrsByBranch = { "feat/x": record() };

	test("finds the branch's PR", () => {
		expect(prFor(prs, "feat/x")?.number).toBe(85);
	});

	test("no branch or no PR is null", () => {
		expect(prFor(prs, null)).toBeNull();
		expect(prFor(prs, "main")).toBeNull();
	});

	test("does not pick up inherited properties", () => {
		expect(prFor(prs, "constructor")).toBeNull();
		expect(prFor(prs, "toString")).toBeNull();
	});
});

describe("chipMinWidth", () => {
	// 제목은 빠진다 — 말줄임으로 0까지 양보하는 몫이다.
	test("sums icon, one gap, number and the box edges, rounded up", () => {
		expect(
			chipMinWidth({ icon: 14, number: 27.3, gap: 6, padding: 18, border: 2 }),
		).toBe(68);
	});
});

describe("prChipView", () => {
	test("hides the chip without a PR", () => {
		expect(prChipView(null)).toBeNull();
	});

	test("carries icon state, number, title and a full tooltip", () => {
		expect(prChipView(record({ state: "merged" }))).toEqual({
			href: "https://github.com/o/r/pull/85",
			state: "merged",
			number: "#85",
			title: "feat: diff 로드 실패 카드가 이유를 말한다",
			tooltip: "#85 feat: diff 로드 실패 카드가 이유를 말한다 — Open on GitHub",
			ariaLabel:
				"Merged pull request #85: feat: diff 로드 실패 카드가 이유를 말한다",
		});
	});
});
