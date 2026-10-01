import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { getRepoSummary } from "../server/summary.ts";

let repo: string;

beforeEach(async () => {
	repo = mkdtempSync(join(tmpdir(), "dd-summary-"));
	await $`git -C ${repo} init -q`;
	await $`git -C ${repo} config user.email t@t.co`;
	await $`git -C ${repo} config user.name test`;
	writeFileSync(join(repo, "a.txt"), "one\n");
	await $`git -C ${repo} add a.txt`;
	await $`git -C ${repo} commit -qm init`;
	await $`git -C ${repo} branch -M main`;
});

afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
});

describe("getRepoSummary", () => {
	test("clean repo on main: zero counts, branch/head/base populated", async () => {
		const s = await getRepoSummary(repo, { base: "main", ref: "main" });
		expect(s.branch).toBe("main");
		expect(s.head).not.toBe("");
		expect(s.base).toBe("main");
		expect(s.workingFiles).toBe(0);
		expect(s.baseFiles).toBe(0);
		expect(s.untrackedFiles).toBe(0);
		expect(s.aheadCommits).toBe(0);
	});

	test("working edit + untracked counted (non-ASCII names)", async () => {
		writeFileSync(join(repo, "a.txt"), "two\n");
		writeFileSync(join(repo, "한글 파일.txt"), "untracked\n");
		const s = await getRepoSummary(repo, { base: "main", ref: "main" });
		expect(s.workingFiles).toBe(1);
		expect(s.untrackedFiles).toBe(1);
	});

	test("feature branch with committed work: baseFiles/aheadCommits", async () => {
		await $`git -C ${repo} checkout -qb feature`;
		writeFileSync(join(repo, "b.txt"), "committed\n");
		await $`git -C ${repo} add b.txt`;
		await $`git -C ${repo} commit -qm work`;
		const s = await getRepoSummary(repo, { base: "main", ref: "main" });
		expect(s.branch).toBe("feature");
		expect(s.workingFiles).toBe(0);
		expect(s.baseFiles).toBe(1);
		expect(s.aheadCommits).toBe(1);
	});

	test("detached HEAD: branch null, head set", async () => {
		const sha = (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
		await $`git -C ${repo} checkout -q ${sha}`;
		const s = await getRepoSummary(repo, { base: "main", ref: "main" });
		expect(s.branch).toBeNull();
		expect(s.head).not.toBe("");
	});

	test("unresolved base: baseFiles/aheadCommits null", async () => {
		const s = await getRepoSummary(repo, { base: null, ref: null });
		expect(s.base).toBeNull();
		expect(s.baseFiles).toBeNull();
		expect(s.aheadCommits).toBeNull();
	});

	test("counts above one are counted exactly (-z NUL parsing)", async () => {
		// 개수가 2 이상이어야 -z를 빼먹은 회귀(개수가 1로 붕괴)를 잡는다.
		writeFileSync(join(repo, "b.txt"), "base\n");
		await $`git -C ${repo} add b.txt`;
		await $`git -C ${repo} commit -qm add-b`;
		await $`git -C ${repo} checkout -qb feature`;
		writeFileSync(join(repo, "d.txt"), "committed-1\n");
		await $`git -C ${repo} add d.txt`;
		await $`git -C ${repo} commit -qm work-1`;
		writeFileSync(join(repo, "e.txt"), "committed-2\n");
		await $`git -C ${repo} add e.txt`;
		await $`git -C ${repo} commit -qm work-2`;
		writeFileSync(join(repo, "a.txt"), "edited\n");
		writeFileSync(join(repo, "b.txt"), "edited\n");
		writeFileSync(join(repo, "u1.txt"), "untracked\n");
		writeFileSync(join(repo, "u2.txt"), "untracked\n");
		const s = await getRepoSummary(repo, { base: "main", ref: "main" });
		expect(s.workingFiles).toBe(2);
		expect(s.untrackedFiles).toBe(2);
		expect(s.aheadCommits).toBe(2);
		expect(s.baseFiles).toBe(4);
	});

	test("merge-base failure (ref without common history) degrades to nulls", async () => {
		await $`git -C ${repo} checkout -q --orphan lonely`;
		await $`git -C ${repo} commit -qm orphan --allow-empty`;
		const s = await getRepoSummary(repo, { base: "main", ref: "main" });
		expect(s.baseFiles).toBeNull();
		expect(s.aheadCommits).toBeNull();
	});
});

test("reports the ref it measured against, prefix intact", async () => {
	const head = (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
	await $`git -C ${repo} update-ref refs/remotes/origin/main ${head}`;
	const summary = await getRepoSummary(repo, {
		base: "main",
		ref: "origin/main",
	});
	expect(summary.base).toBe("main");
	expect(summary.ref).toBe("origin/main");
});

describe("getRepoSummary with a head revision", () => {
	// 0으로 적으면 미커밋 변경이 있어도 카드가 "볼 것이 없다"고 주장한다.
	test("does not claim anything about the working tree", async () => {
		await $`git -C ${repo} branch -M main`;
		await $`git -C ${repo} checkout -qb feat`;
		writeFileSync(join(repo, "a.txt"), "feat\n");
		await $`git -C ${repo} commit -qam feat`;
		await $`git -C ${repo} checkout -q main`;
		writeFileSync(join(repo, "a.txt"), "dirty\n");
		writeFileSync(join(repo, "scratch.txt"), "untracked\n");

		const s = await getRepoSummary(repo, {
			base: "main",
			ref: "main",
			head: "feat",
		});
		expect(s.workingFiles).toBeNull();
		expect(s.untrackedFiles).toBeNull();
	});

	test("names the branch being viewed, not the worktree's", async () => {
		await $`git -C ${repo} branch -M main`;
		await $`git -C ${repo} branch feat`;
		const s = await getRepoSummary(repo, {
			base: "main",
			ref: "main",
			head: "feat",
		});
		expect(s.branch).toBe("feat");
	});

	test("counts the base diff against the head revision", async () => {
		await $`git -C ${repo} branch -M main`;
		await $`git -C ${repo} checkout -qb feat`;
		writeFileSync(join(repo, "a.txt"), "feat\n");
		await $`git -C ${repo} commit -qam feat`;
		await $`git -C ${repo} checkout -q main`;

		const s = await getRepoSummary(repo, {
			base: "main",
			ref: "main",
			head: "feat",
		});
		expect(s.baseFiles).toBe(1);
		expect(s.aheadCommits).toBe(1);
	});
});
