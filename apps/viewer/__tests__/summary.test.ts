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

	test("merge-base failure (ref without common history) degrades to nulls", async () => {
		// orphan 브랜치는 main과 merge-base가 없다 → resolveDiffBaseRev가 "" 반환.
		await $`git -C ${repo} checkout -q --orphan lonely`;
		await $`git -C ${repo} commit -qm orphan --allow-empty`;
		const s = await getRepoSummary(repo, { base: "main", ref: "main" });
		expect(s.baseFiles).toBeNull();
		expect(s.aheadCommits).toBeNull();
	});
});
