import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
	getRefs,
	parseRefList,
	parseRepoRoot,
	parseWorktreeList,
} from "../server/refs.ts";

// `git worktree list --porcelain -z` 형식: 속성 한 줄마다 NUL이 붙고, 레코드 사이는 빈 항목이다.
const wt = (...records: string[][]): string =>
	`${records.map((lines) => lines.map((l) => `${l}\0`).join("")).join("\0")}\0`;

// `for-each-ref --format=...%00...%00` 형식: 필드마다 NUL, 레코드 사이에 리터럴
// 개행이 하나 들어간다.
const refs = (...records: string[][]): string =>
	records.map((fields) => `${fields.join("\0")}\0`).join("\n");

describe("parseRepoRoot", () => {
	// git은 링크·중첩 워크트리에서 실행해도 메인 워크트리를 항상 먼저 낸다.
	test("takes the first record — the main worktree", () => {
		const raw = wt(
			["worktree /repo", "HEAD abc", "branch refs/heads/main"],
			[
				"worktree /repo/.claude/worktrees/feat",
				"HEAD abc",
				"branch refs/heads/feat",
			],
		);
		expect(parseRepoRoot(raw)).toBe("/repo");
	});

	// parseWorktreeList는 bare를 걸러내 첫 항목이 링크된 워크트리가 된다 — 필터
	// 전 원본을 읽는 이유다.
	test("keeps the bare main worktree that parseWorktreeList drops", () => {
		const raw = wt(
			["worktree /srv/myproj.git", "bare"],
			["worktree /srv/wt-feat", "HEAD abc", "branch refs/heads/feat"],
		);
		expect(parseRepoRoot(raw)).toBe("/srv/myproj.git");
		expect(parseWorktreeList(raw).map((w) => w.path)).toEqual(["/srv/wt-feat"]);
	});

	test("keeps a prunable main worktree too", () => {
		const raw = wt(
			[
				"worktree /repo",
				"HEAD abc",
				"prunable gitdir file points to non-existent location",
			],
			["worktree /wt", "HEAD abc", "branch refs/heads/feat"],
		);
		expect(parseRepoRoot(raw)).toBe("/repo");
	});

	test("returns null when git said nothing", () => {
		expect(parseRepoRoot("")).toBeNull();
		expect(parseRepoRoot("\0")).toBeNull();
	});
});

describe("parseWorktreeList", () => {
	test("reads path, branch and head from an attached worktree", () => {
		const out = parseWorktreeList(
			wt(["worktree /repo", "HEAD abc123", "branch refs/heads/main"]),
		);
		expect(out).toEqual([
			{ path: "/repo", branch: "main", head: "abc123", detached: false },
		]);
	});

	test("marks a detached worktree and leaves its branch null", () => {
		const out = parseWorktreeList(
			wt(["worktree /wt", "HEAD abc123", "detached"]),
		);
		expect(out).toEqual([
			{ path: "/wt", branch: null, head: "abc123", detached: true },
		]);
	});

	// 디렉토리가 사라져도 git은 그 등록을 branch 줄까지 달고 낸다 — 고르게 두면
	// 없는 경로로 이동해 빠져나올 수 없다.
	test("drops a worktree whose directory is gone", () => {
		const out = parseWorktreeList(
			wt(
				["worktree /alive", "HEAD abc", "branch refs/heads/main"],
				[
					"worktree /gone",
					"HEAD abc",
					"branch refs/heads/feat",
					"prunable gitdir file points to non-existent location",
				],
			),
		);
		expect(out.map((w) => w.path)).toEqual(["/alive"]);
	});

	test("drops a bare repository, which has no working tree at all", () => {
		const out = parseWorktreeList(
			wt(
				["worktree /bare.git", "bare"],
				["worktree /real", "HEAD abc", "branch refs/heads/main"],
			),
		);
		expect(out.map((w) => w.path)).toEqual(["/real"]);
	});

	test("tolerates an empty listing", () => {
		expect(parseWorktreeList("")).toEqual([]);
	});
});

describe("parseRefList", () => {
	const live = new Set(["/repo", "/wt-a"]);

	test("splits local and remote refs by their prefix", () => {
		const { refs: out } = parseRefList(
			refs(
				["refs/heads/main", "main", "", ""],
				["refs/remotes/origin/main", "origin/main", "", ""],
			),
			live,
		);
		expect(out).toEqual([
			{ name: "main", kind: "local", worktreePath: null },
			{ name: "origin/main", kind: "remote", worktreePath: null },
		]);
	});

	test("attributes a branch to the worktree holding it", () => {
		const { refs: out } = parseRefList(
			refs(["refs/heads/feat", "feat", "/wt-a", ""]),
			live,
		);
		expect(out[0]?.worktreePath).toBe("/wt-a");
	});

	// for-each-ref는 죽은 워크트리 경로도 그대로 싣는다 — 살아 있는 워크트리 집합과 교차 확인한다.
	test("ignores a worktree path that is no longer live", () => {
		const { refs: out } = parseRefList(
			refs(["refs/heads/feat", "feat", "/wt-gone", ""]),
			live,
		);
		expect(out[0]?.worktreePath).toBeNull();
	});

	// git은 refname에 "|"를 허용한다 — 필드 구분자가 NUL인 이유다.
	test("keeps a refname containing a pipe intact", () => {
		const { refs: out } = parseRefList(
			refs(["refs/heads/weird|pipe", "weird|pipe", "", ""]),
			live,
		);
		expect(out[0]?.name).toBe("weird|pipe");
	});

	test("reports the default branch from origin/HEAD and hides the pseudo-ref", () => {
		const { refs: out, defaultBranch } = parseRefList(
			refs(
				["refs/remotes/origin/HEAD", "origin", "", "refs/remotes/origin/main"],
				["refs/remotes/origin/main", "origin/main", "", ""],
			),
			live,
		);
		expect(defaultBranch).toBe("main");
		expect(out.map((r) => r.name)).toEqual(["origin/main"]);
	});

	test("reports no default branch when origin/HEAD is unset", () => {
		const { defaultBranch } = parseRefList(
			refs(["refs/heads/main", "main", "", ""]),
			live,
		);
		expect(defaultBranch).toBeNull();
	});

	test("tolerates an empty listing", () => {
		expect(parseRefList("", live)).toEqual({ refs: [], defaultBranch: null });
	});
});

// 위 픽스처 문자열은 git이 실제로 그렇게 낸다는 것까지는 증명하지 않으므로 진짜
// git 출력으로도 본다.
describe("getRefs against a real repository", () => {
	let root: string;
	let repo: string;

	beforeEach(async () => {
		// macOS의 /var는 /private/var 심링크이고 git은 워크트리 경로를 realpath로 준다.
		root = realpathSync(mkdtempSync(join(tmpdir(), "dd-refs-")));
		repo = join(root, "main-wt");
		await $`git init -q ${repo}`;
		await $`git -C ${repo} config user.email t@t.co`;
		await $`git -C ${repo} config user.name test`;
		await $`git -C ${repo} commit -q --allow-empty -m init`;
		// git init은 머신의 init.defaultBranch를 따르므로(CI 러너는 master) 이름을 고정한다.
		await $`git -C ${repo} branch -M main`;
		await $`git -C ${repo} branch feat-a`;
		await $`git -C ${repo} branch feat-gone`;
		// 워크트리는 repo의 형제로 만든다 — 안에 만들면 git status에 잡힌다.
		await $`git -C ${repo} worktree add -q ${join(root, "wt-a")} feat-a`;
		await $`git -C ${repo} worktree add -q ${join(root, "wt-gone")} feat-gone`;
		rmSync(join(root, "wt-gone"), { recursive: true, force: true });
	});

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	test("lists live worktrees and drops the one whose directory is gone", async () => {
		const { worktrees } = await getRefs(repo);
		expect(
			worktrees
				.map((w) => w.branch)
				.toSorted((a, b) => String(a).localeCompare(String(b))),
		).toEqual(["feat-a", "main"]);
	});

	test("attributes a branch to its worktree but not to a dead one", async () => {
		const { refs: out } = await getRefs(repo);
		const byName = new Map(out.map((r) => [r.name, r]));
		expect(byName.get("feat-a")?.worktreePath).toBe(join(root, "wt-a"));
		expect(byName.get("feat-gone")?.worktreePath).toBeNull();
	});

	test("reads the default branch from origin/HEAD when it is set", async () => {
		const head = (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
		const ref = "refs/remotes/origin/main";
		await $`git -C ${repo} update-ref ${ref} ${head}`;
		await $`git -C ${repo} symbolic-ref refs/remotes/origin/HEAD ${ref}`;
		const { refs: out, defaultBranch } = await getRefs(repo);
		expect(defaultBranch).toBe("main");
		// 짧게 쓰면 "origin"이 되는 유사 참조는 목록에 없어야 한다.
		expect(out.map((r) => r.name)).not.toContain("origin");
	});
});
