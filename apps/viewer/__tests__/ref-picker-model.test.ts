import { describe, expect, test } from "bun:test";
import { buildHeadRows, filterPickerRows } from "../browser/refPicker/model.ts";
import type { PrsByBranch } from "../server/prs.ts";
import type { RefRecord, WorktreeRecord } from "../server/refs.ts";

const ref = (name: string, kind: "local" | "remote" = "local"): RefRecord => ({
	name,
	kind,
	worktreePath: null,
});

const wt = (path: string, branch: string | null): WorktreeRecord => ({
	path,
	branch,
	head: "abc1234",
	detached: branch === null,
});

const MAIN_WT = wt("/w/repo", "main");
const FEAT_WT = wt("/w/repo/.claude/worktrees/feat", "feat");

describe("buildHeadRows — worktrees", () => {
	// 고를 것이 없으면 구역 자체가 없다. 제목만 남기고 목록을 비우면
	// "뭔가 있어야 하는데 없다"로 읽힌다.
	test("omits the worktree section when there is nothing to choose", () => {
		const rows = buildHeadRows([MAIN_WT], [ref("main")], "main", {
			repo: "/w/repo",
			head: null,
		});
		expect(rows.some((r) => r.section === "worktrees")).toBe(false);
	});

	// 숨김은 "고를 것이 없을 때"의 규칙이다. 브랜치를 head로 보고 있으면
	// 워크트리는 지금 보고 있지 않은 것이므로 고를 대상이고, 숨기면 워크트리가
	// 하나뿐인 리포에서 브랜치 뷰에 갇혀 돌아올 길이 사라진다.
	test("keeps the section while a branch head is active, to get back", () => {
		const rows = buildHeadRows([MAIN_WT], [ref("dev")], "main", {
			repo: "/w/repo",
			head: "dev",
		});
		expect(rows.filter((r) => r.section === "worktrees")).toHaveLength(1);
	});

	test("shows the section as soon as a second worktree exists", () => {
		const rows = buildHeadRows([MAIN_WT, FEAT_WT], [], "main", {
			repo: "/w/repo",
			head: null,
		});
		expect(rows.filter((r) => r.section === "worktrees")).toHaveLength(2);
	});

	// 어느 브랜치를 물고 있는지 행 자체가 말해야 한다.
	test("each worktree names the branch it holds", () => {
		const rows = buildHeadRows([MAIN_WT, FEAT_WT], [], "main", {
			repo: "/w/repo",
			head: null,
		});
		const feat = rows.find((r) => r.label === "feat");
		expect(feat?.note).toBe("feat");
	});

	// default 브랜치를 물고 있는 워크트리가 맨 위 — 브랜치 구역과 같은 규칙.
	test("puts the worktree holding the default branch first", () => {
		const rows = buildHeadRows([FEAT_WT, MAIN_WT], [], "main", {
			repo: "/w/repo/.claude/worktrees/feat",
			head: null,
		});
		const worktrees = rows.filter((r) => r.section === "worktrees");
		expect(worktrees[0]?.label).toBe("repo");
		expect(worktrees[0]?.note).toBe("main · default");
	});

	test("the worktree being viewed is the selected row", () => {
		const rows = buildHeadRows([MAIN_WT, FEAT_WT], [], "main", {
			repo: "/w/repo/.claude/worktrees/feat",
			head: null,
		});
		expect(rows.find((r) => r.selected)?.label).toBe("feat");
	});

	// repo는 기동 시점의 cwd라 리포 루트라는 보장이 없다. repoLabel의
	// findWorktree와 **같은 판정**을 써야 답이 앱 안에 하나만 남는다.
	test("matches the viewed worktree from a subdirectory", () => {
		const rows = buildHeadRows([MAIN_WT, FEAT_WT], [], "main", {
			repo: "/w/repo/.claude/worktrees/feat/src",
			head: null,
		});
		expect(rows.find((r) => r.selected)?.label).toBe("feat");
	});

	// 브랜치를 head로 보고 있으면 워크트리는 어느 것도 선택 상태가 아니다.
	test("no worktree is selected while a branch is the head", () => {
		const rows = buildHeadRows([MAIN_WT, FEAT_WT], [ref("dev")], "main", {
			repo: "/w/repo",
			head: "dev",
		});
		expect(rows.filter((r) => r.section === "worktrees" && r.selected)).toEqual(
			[],
		);
	});

	test("carries the worktree path as its value — that is what navigates", () => {
		const rows = buildHeadRows([MAIN_WT, FEAT_WT], [], "main", {
			repo: "/w/repo",
			head: null,
		});
		expect(rows.find((r) => r.label === "feat")?.value).toBe(FEAT_WT.path);
	});

	test("a detached worktree still lists, with no branch to name", () => {
		const rows = buildHeadRows([MAIN_WT, wt("/w/other", null)], [], "main", {
			repo: "/w/repo",
			head: null,
		});
		expect(rows.find((r) => r.label === "other")?.note).toBeNull();
	});
});

describe("buildHeadRows — branches", () => {
	const refs = [
		ref("aaa"),
		ref("dev"),
		ref("main"),
		ref("origin/main", "remote"),
	];

	test("default branch first, then the branch being viewed", () => {
		const rows = buildHeadRows([MAIN_WT], refs, "main", {
			repo: "/w/repo",
			head: "dev",
		});
		expect(
			rows.filter((r) => r.section === "branches").map((r) => r.value),
		).toEqual(["main", "dev", "aaa", "origin/main"]);
	});

	test("keeps local branches ahead of remote ones", () => {
		const rows = buildHeadRows([MAIN_WT], refs, null, {
			repo: "/w/repo",
			head: null,
		});
		expect(rows.map((r) => r.kind)).toEqual([
			"local",
			"local",
			"local",
			"remote",
		]);
	});

	test("tags the default branch", () => {
		const rows = buildHeadRows([MAIN_WT], refs, "main", {
			repo: "/w/repo",
			head: null,
		});
		expect(rows.find((r) => r.value === "main")?.tag).toBe("default");
		expect(rows.find((r) => r.value === "dev")?.tag).toBeNull();
	});

	test("the branch being viewed is the selected row", () => {
		const rows = buildHeadRows([MAIN_WT], refs, "main", {
			repo: "/w/repo",
			head: "dev",
		});
		expect(rows.find((r) => r.selected)?.value).toBe("dev");
	});

	test("carries the ref name as its value — that is what head takes", () => {
		const rows = buildHeadRows([MAIN_WT], refs, "main", {
			repo: "/w/repo",
			head: null,
		});
		expect(rows.find((r) => r.value === "origin/main")?.kind).toBe("remote");
	});
});

describe("filterPickerRows", () => {
	const rows = buildHeadRows(
		[MAIN_WT, FEAT_WT],
		[ref("main"), ref("feat/grab-popover")],
		"main",
		{ repo: "/w/repo", head: null },
	);

	test("an empty query keeps every row", () => {
		expect(filterPickerRows(rows, "")).toHaveLength(rows.length);
	});

	test("matches anywhere in the label, not just the start", () => {
		expect(filterPickerRows(rows, "grab").map((r) => r.value)).toEqual([
			"feat/grab-popover",
		]);
	});

	test("ignores case and surrounding whitespace", () => {
		expect(filterPickerRows(rows, "  GRAB ")).toHaveLength(1);
	});

	test("returns nothing when the query matches nothing", () => {
		expect(filterPickerRows(rows, "zzz")).toEqual([]);
	});

	// 워크트리 행의 **브랜치 이름**은 label이 아니라 note에 산다. label만 보면
	// 이 목록에서 가장 자연스러운 검색어(브랜치명)로 워크트리를 못 찾는다.
	test("finds a worktree by the branch it holds", () => {
		const held = filterPickerRows(rows, "feat").map((r) => r.value);
		expect(held).toContain("/w/repo/.claude/worktrees/feat");
	});
});

describe("buildHeadRows — pull requests", () => {
	const prs: PrsByBranch = {
		feat: {
			number: 85,
			title: "feat: 로드 실패 카드",
			state: "open",
			url: "https://github.com/o/r/pull/85",
		},
		old: {
			number: 12,
			title: "fix: 옛 일",
			state: "merged",
			url: "https://github.com/o/r/pull/12",
		},
	};
	const current = { repo: "/w/repo", head: null };

	test("rows carry no PR until PRs are known", () => {
		const rows = buildHeadRows(
			[MAIN_WT, FEAT_WT],
			[ref("feat")],
			"main",
			current,
		);
		expect(rows.every((r) => r.pr === null)).toBe(true);
	});

	// 워크트리 행은 **물고 있는 브랜치**의 PR을 단다.
	test("a worktree row carries the PR of the branch it holds", () => {
		const rows = buildHeadRows([MAIN_WT, FEAT_WT], [], "main", current, prs);
		const feat = rows.find((r) => r.value === FEAT_WT.path);
		expect(feat?.pr?.number).toBe(85);
		expect(rows.find((r) => r.value === MAIN_WT.path)?.pr).toBeNull();
	});

	test("local and remote branch rows both carry the branch's PR", () => {
		const rows = buildHeadRows(
			[MAIN_WT],
			[ref("feat"), ref("origin/feat", "remote"), ref("old"), ref("main")],
			"main",
			current,
			prs,
		);
		const byValue = (v: string) => rows.find((r) => r.value === v)?.pr;
		expect(byValue("feat")?.number).toBe(85);
		expect(byValue("origin/feat")?.number).toBe(85);
		expect(byValue("old")?.state).toBe("merged");
		expect(byValue("main")).toBeNull();
	});

	// 행에 보이는 글자는 전부 검색어가 된다.
	test("filtering finds a row by PR number or title", () => {
		const rows = buildHeadRows(
			[MAIN_WT],
			[ref("feat"), ref("old"), ref("main")],
			"main",
			current,
			prs,
		);
		const values = (q: string) => filterPickerRows(rows, q).map((r) => r.value);
		expect(values("#85")).toEqual(["feat"]);
		expect(values("12")).toEqual(["old"]);
		expect(values("로드 실패")).toEqual(["feat"]);
		expect(values("FIX:")).toEqual(["old"]);
	});
});
