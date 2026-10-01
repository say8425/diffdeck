import { describe, expect, test } from "bun:test";
import {
	findWorktree,
	repoDisplayName,
	repoLabelView,
} from "../browser/repoLabel.ts";
import type { WorktreeRecord } from "../server/refs.ts";

const wt = (over: Partial<WorktreeRecord> = {}): WorktreeRecord => ({
	path: "/Users/p/dev/diffdeck",
	branch: "main",
	head: "9d698840eb19bab30db54a18db1f4dc6cc9b1dc1",
	detached: false,
	...over,
});

describe("repoDisplayName", () => {
	test("절대 경로의 마지막 세그먼트", () => {
		expect(repoDisplayName("/Users/p/dev/diffdeck")).toBe("diffdeck");
	});

	// 커버리지 게이트는 branch를 세지 않아 후행 슬래시 폴백 분기를 일부러 찌른다.
	test("후행 슬래시를 벗긴다", () => {
		expect(repoDisplayName("/Users/p/dev/diffdeck/")).toBe("diffdeck");
		expect(repoDisplayName("/Users/p/dev/diffdeck///")).toBe("diffdeck");
	});

	test("루트와 빈 문자열에는 이름이 없다", () => {
		expect(repoDisplayName("/")).toBe("");
		expect(repoDisplayName("")).toBe("");
	});

	test("슬래시가 없는 상대 경로는 그 자체가 이름이다", () => {
		expect(repoDisplayName("diffdeck")).toBe("diffdeck");
	});

	test("비-ASCII 이름을 보존한다", () => {
		expect(repoDisplayName("/Users/p/dev/무신사-프론트")).toBe("무신사-프론트");
	});
});

describe("findWorktree", () => {
	test("경로가 정확히 같은 워크트리를 찾는다", () => {
		const a = wt({ path: "/w/a" });
		const b = wt({ path: "/w/b" });
		expect(findWorktree([a, b], "/w/b")).toBe(b);
	});

	// repo는 CLI 기동 시점의 cwd라 리포 루트가 아닐 수 있다.
	test("하위 디렉토리에서 기동해도 그 워크트리를 찾는다", () => {
		const a = wt({ path: "/w/a" });
		expect(findWorktree([a], "/w/a/apps/viewer")).toBe(a);
	});

	test("중첩 워크트리에서는 가장 안쪽이 이긴다", () => {
		const outer = wt({ path: "/w/a", branch: "main" });
		const inner = wt({ path: "/w/a/.claude/worktrees/feat", branch: "feat" });
		expect(findWorktree([outer, inner], "/w/a/.claude/worktrees/feat")).toBe(
			inner,
		);
		expect(
			findWorktree([outer, inner], "/w/a/.claude/worktrees/feat/src"),
		).toBe(inner);
	});

	test("경로 세그먼트 경계에서만 일치한다", () => {
		const a = wt({ path: "/w/a" });
		// `/w/abc`는 `/w/a`의 하위가 아니다 — 접두 문자열 비교만 하면 걸린다.
		expect(findWorktree([a], "/w/abc")).toBeNull();
	});

	test("목록에 없으면 null", () => {
		expect(findWorktree([wt({ path: "/w/a" })], "/other")).toBeNull();
	});

	test("빈 목록이면 null", () => {
		expect(findWorktree([], "/w/a")).toBeNull();
	});

	test("양쪽의 후행 슬래시를 무시한다", () => {
		const a = wt({ path: "/w/a/" });
		expect(findWorktree([a], "/w/a")).toBe(a);
	});
});

describe("repoLabelView", () => {
	const MAIN = "/Users/p/dev/diffdeck";

	test("메인 워크트리에서는 리포 이름과 브랜치만 말한다", () => {
		const v = repoLabelView(MAIN, [wt()], MAIN);
		expect(v.scope).toBe("");
		expect(v.name).toBe("diffdeck");
		expect(v.branch).toBe(" · main");
		expect(v.title).toBe("/Users/p/dev/diffdeck · main");
		expect(v.documentTitle).toBe("diffdeck · main — diffdeck");
	});

	test("링크된 워크트리에서는 리포를 앞에 덧붙인다", () => {
		const inner = "/Users/p/dev/diffdeck/.claude/worktrees/feat+ABC-1";
		const v = repoLabelView(
			inner,
			[wt(), wt({ path: inner, branch: "feat/ABC-1" })],
			MAIN,
		);
		expect(v.scope).toBe("diffdeck / ");
		expect(v.name).toBe("feat+ABC-1");
		expect(v.branch).toBe(" · feat/ABC-1");
		expect(v.title).toBe(`${inner} · feat/ABC-1`);
		// 탭은 오른쪽부터 잘리므로 구별되는 워크트리 이름을 앞에 두고 리포 접두는 넣지 않는다.
		expect(v.documentTitle).toBe("feat+ABC-1 · feat/ABC-1 — diffdeck");
	});

	test("형제 워크트리도 리포를 앞에 덧붙인다", () => {
		const sibling = "/Users/p/dev/diffdeck-feat";
		const v = repoLabelView(
			sibling,
			[wt(), wt({ path: sibling, branch: "feat" })],
			MAIN,
		);
		expect(v.scope).toBe("diffdeck / ");
		expect(v.name).toBe("diffdeck-feat");
	});

	// bare 리포의 메인 항목은 worktrees[]에서 빠지므로 리포 루트는 따로 온다.
	test("bare 리포 루트의 .git 접미를 벗긴다", () => {
		const v = repoLabelView(
			"/srv/wt-feat",
			[wt({ path: "/srv/wt-feat", branch: "feat" })],
			"/srv/myproj.git",
		);
		expect(v.scope).toBe("myproj / ");
		expect(v.name).toBe("wt-feat");
	});

	test("하위 디렉토리에서 켜도 워크트리 최상위 이름을 말한다", () => {
		const v = repoLabelView(`${MAIN}/apps/viewer`, [wt()], MAIN);
		expect(v.scope).toBe("");
		expect(v.name).toBe("diffdeck");
		expect(v.title).toBe("/Users/p/dev/diffdeck · main");
	});

	test("링크된 워크트리의 하위 디렉토리에서 켜도 둘 다 말한다", () => {
		const inner = "/w/repo/.claude/worktrees/feat";
		const v = repoLabelView(
			`${inner}/src`,
			[wt({ path: "/w/repo" }), wt({ path: inner, branch: "feat" })],
			"/w/repo",
		);
		expect(v.scope).toBe("repo / ");
		expect(v.name).toBe("feat");
	});

	// detached 표기는 emptyState.ts와 같은 어휘를 쓴다.
	test("detached HEAD는 짧은 OID로 말한다", () => {
		const v = repoLabelView(
			"/w/a",
			[
				wt({
					path: "/w/a",
					branch: null,
					detached: true,
					head: "abc1234def567",
				}),
			],
			"/w/a",
		);
		expect(v.branch).toBe(" · detached @ abc1234");
		expect(v.title).toBe("/w/a · detached @ abc1234");
	});

	test("브랜치가 빈 문자열이어도 detached로 읽는다", () => {
		const v = repoLabelView(
			"/w/a",
			[wt({ path: "/w/a", branch: "", head: "abc1234def567" })],
			"/w/a",
		);
		expect(v.branch).toBe(" · detached @ abc1234");
	});

	test("브랜치도 head도 없으면 브랜치 자리를 비운다", () => {
		const v = repoLabelView(
			"/w/a",
			[wt({ path: "/w/a", branch: null, head: null })],
			"/w/a",
		);
		expect(v.name).toBe("a");
		expect(v.branch).toBe("");
		expect(v.title).toBe("/w/a");
		expect(v.documentTitle).toBe("a — diffdeck");
	});

	// /api/refs가 오기 전(또는 실패한) 첫 프레임이다.
	test("워크트리 목록이 비어도 이름은 말한다", () => {
		const v = repoLabelView(MAIN, [], null);
		expect(v.scope).toBe("");
		expect(v.name).toBe("diffdeck");
		expect(v.branch).toBe("");
		expect(v.title).toBe("/Users/p/dev/diffdeck");
	});

	test("repoRoot가 null이면 접두를 붙이지 않는다", () => {
		const inner = "/w/repo/.claude/worktrees/feat";
		const v = repoLabelView(inner, [wt({ path: inner, branch: "feat" })], null);
		expect(v.scope).toBe("");
		expect(v.name).toBe("feat");
	});

	// 루트("/")의 리포는 이름이 없다 — 빈 이름을 접두로 쓰면 라벨이 " / feat"로 시작한다.
	test("리포 루트가 이름을 못 내면 접두를 생략한다", () => {
		const v = repoLabelView("/w", [wt({ path: "/w", branch: "feat" })], "/");
		expect(v.scope).toBe("");
		expect(v.name).toBe("w");
	});

	test("repo가 비면 아무 말도 하지 않고 탭 제목은 앱 이름뿐", () => {
		const v = repoLabelView("", [], null);
		expect(v.scope).toBe("");
		expect(v.name).toBe("");
		expect(v.branch).toBe("");
		expect(v.title).toBe("");
		expect(v.documentTitle).toBe("diffdeck");
	});

	test("비-ASCII 리포·워크트리·브랜치명을 보존한다", () => {
		const inner = "/w/무신사/워크트리/댓글";
		const v = repoLabelView(
			inner,
			[wt({ path: "/w/무신사" }), wt({ path: inner, branch: "기능/댓글" })],
			"/w/무신사",
		);
		expect(v.scope).toBe("무신사 / ");
		expect(v.name).toBe("댓글");
		expect(v.branch).toBe(" · 기능/댓글");
		expect(v.documentTitle).toBe("댓글 · 기능/댓글 — diffdeck");
	});
});

describe("repoLabelView — 무엇을 보고 있는지", () => {
	const MAIN = "/Users/p/dev/diffdeck";
	const INNER = "/Users/p/dev/diffdeck/.claude/worktrees/feat+ABC-1";
	const trees = [wt(), wt({ path: INNER, branch: "feat/ABC-1" })];

	// 견줄 기준은 말하지 않는다 — 화면에서 고를 수 없는 값이다(viewer-toolbar.md).
	test("워크트리 뷰의 title은 경로와 브랜치만 말한다", () => {
		const v = repoLabelView(MAIN, [wt()], MAIN, { head: null });
		expect(v.branch).toBe(" · main");
		expect(v.title).toBe("/Users/p/dev/diffdeck · main");
		expect(v).not.toHaveProperty("base");
	});

	test("브랜치 뷰의 title은 리포 루트와 그 브랜치만 말한다", () => {
		const v = repoLabelView(INNER, trees, MAIN, { head: "feature/other" });
		expect(v.title).toBe("/Users/p/dev/diffdeck · feature/other");
	});

	// 브랜치를 head로 보면 어느 워크트리에서 보든 같은 diff라, 워크트리 이름은 잘못된 인상을 준다.
	test("브랜치 뷰에서는 워크트리 이름을 빼고 그 브랜치를 주인공으로 세운다", () => {
		const v = repoLabelView(INNER, trees, MAIN, {
			head: "feature/other",
		});
		expect(v.scope).toBe("diffdeck · ");
		expect(v.name).toBe("feature/other");
		expect(v.branch).toBe("");
	});

	test("브랜치 뷰의 라벨은 워크트리의 브랜치를 말하지 않는다", () => {
		const v = repoLabelView(INNER, trees, MAIN, {
			head: "feature/other",
		});
		expect(v.branch).not.toContain("feat/ABC-1");
		expect(v.name).not.toBe("feat+ABC-1");
	});

	test("브랜치 뷰의 탭 제목은 그 브랜치를 앞세운다", () => {
		const v = repoLabelView(INNER, trees, MAIN, {
			head: "feature/other",
		});
		expect(v.documentTitle).toBe("feature/other — diffdeck");
	});

	test("리포 루트를 모르면 브랜치 뷰에서도 접두를 지어내지 않는다", () => {
		const v = repoLabelView(INNER, trees, null, {
			head: "feature/other",
		});
		expect(v.scope).toBe("");
		expect(v.name).toBe("feature/other");
	});

	test("워크트리 뷰는 예전 형태 그대로다", () => {
		const v = repoLabelView(INNER, trees, MAIN, { head: null });
		expect(v.scope).toBe("diffdeck / ");
		expect(v.name).toBe("feat+ABC-1");
		expect(v.branch).toBe(" · feat/ABC-1");
	});
});
