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

	// 후행 슬래시는 별개의 폴백 분기다. 커버리지 게이트가 branch를 세지
	// 않으므로(CLAUDE.md) 분기마다 일부러 찔러 둔다.
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

	// 한글 경로가 뭉개지면 라벨이 자기 워크트리를 잘못 말한다.
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

	// repo는 CLI 기동 시점의 process.cwd()라 리포 루트라는 보장이 없다.
	// 정확 일치만 보면 하위 디렉토리에서 켰을 때 브랜치가 조용히 사라진다.
	test("하위 디렉토리에서 기동해도 그 워크트리를 찾는다", () => {
		const a = wt({ path: "/w/a" });
		expect(findWorktree([a], "/w/a/apps/viewer")).toBe(a);
	});

	// 중첩 워크트리(.claude/worktrees/* 관례)에서 바깥 것이 이기면
	// 라벨이 엉뚱한 워크트리를 말한다 — 사용자가 겪은 바로 그 혼동이다.
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
	test("워크트리 이름과 브랜치를 말한다", () => {
		const v = repoLabelView("/Users/p/dev/diffdeck", [wt()]);
		expect(v.name).toBe("diffdeck");
		expect(v.branch).toBe(" · main");
		expect(v.title).toBe("/Users/p/dev/diffdeck · main");
		expect(v.documentTitle).toBe("diffdeck · main — diffdeck");
	});

	// 하위 디렉토리에서 켜면 basename(repo)는 `viewer`다. 워크트리를 찾았으면
	// 그 최상위 경로의 이름이 옳다.
	test("하위 디렉토리에서 켜도 워크트리 최상위 이름을 말한다", () => {
		const v = repoLabelView("/Users/p/dev/diffdeck/apps/viewer", [wt()]);
		expect(v.name).toBe("diffdeck");
		expect(v.title).toBe("/Users/p/dev/diffdeck · main");
	});

	// detached 표기는 emptyState.ts와 같은 어휘를 쓴다 — 같은 사실을 화면
	// 두 곳이 다르게 말하면 안 된다.
	test("detached HEAD는 짧은 OID로 말한다", () => {
		const v = repoLabelView("/w/a", [
			wt({ path: "/w/a", branch: null, detached: true, head: "abc1234def567" }),
		]);
		expect(v.branch).toBe(" · detached @ abc1234");
		expect(v.title).toBe("/w/a · detached @ abc1234");
	});

	test("브랜치가 빈 문자열이어도 detached로 읽는다", () => {
		const v = repoLabelView("/w/a", [
			wt({ path: "/w/a", branch: "", head: "abc1234def567" }),
		]);
		expect(v.branch).toBe(" · detached @ abc1234");
	});

	test("브랜치도 head도 없으면 브랜치 자리를 비운다", () => {
		const v = repoLabelView("/w/a", [
			wt({ path: "/w/a", branch: null, head: null }),
		]);
		expect(v.name).toBe("a");
		expect(v.branch).toBe("");
		expect(v.title).toBe("/w/a");
		expect(v.documentTitle).toBe("a — diffdeck");
	});

	// /api/refs가 아직 안 왔거나 실패한 첫 프레임. 이름은 repo 경로에서
	// 즉시 알 수 있으므로 브랜치만 비운다 — hidden 토글이 필요 없어진다.
	test("워크트리 목록이 비어도 이름은 말한다", () => {
		const v = repoLabelView("/Users/p/dev/diffdeck", []);
		expect(v.name).toBe("diffdeck");
		expect(v.branch).toBe("");
		expect(v.title).toBe("/Users/p/dev/diffdeck");
	});

	test("repo가 비면 아무 말도 하지 않고 탭 제목은 앱 이름뿐", () => {
		const v = repoLabelView("", []);
		expect(v.name).toBe("");
		expect(v.branch).toBe("");
		expect(v.title).toBe("");
		expect(v.documentTitle).toBe("diffdeck");
	});

	test("비-ASCII 워크트리명과 브랜치명을 보존한다", () => {
		const v = repoLabelView("/w/무신사", [
			wt({ path: "/w/무신사", branch: "기능/댓글" }),
		]);
		expect(v.name).toBe("무신사");
		expect(v.branch).toBe(" · 기능/댓글");
		expect(v.documentTitle).toBe("무신사 · 기능/댓글 — diffdeck");
	});
});
