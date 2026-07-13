import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { defaultBranchName, getDiffFiles, prBaseName } from "../server/diff.ts";

const dirs: string[] = [];

const mkRepo = (prefix: string): string => {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
};

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("prBaseName", () => {
	test("returns null when the spawn itself fails (non-existent cwd)", async () => {
		const result = await prBaseName("/no/such/dir/xyz");
		expect(result).toBeNull();
	});
});

describe("defaultBranchName", () => {
	test("resolves the branch name when refs/remotes/origin/HEAD is set", async () => {
		const repo = mkRepo("dd-gaps-repo-");
		const bare = mkRepo("dd-gaps-bare-");
		await $`git -C ${repo} init -q`;
		await $`git -C ${repo} config user.email t@t.co`;
		await $`git -C ${repo} config user.name test`;
		writeFileSync(join(repo, "a.txt"), "one\n");
		await $`git -C ${repo} add a.txt`;
		await $`git -C ${repo} commit -qm init`;
		await $`git -C ${repo} branch -M main`;
		await $`git init -q --bare ${bare}`;
		await $`git -C ${repo} remote add origin ${bare}`;
		await $`git -C ${repo} push -q origin main`;
		await $`git -C ${repo} fetch -q origin`;
		await $`git -C ${repo} remote set-head origin main`;

		const result = await defaultBranchName(repo);
		expect(result).toBe("main");
	});

	test("returns null when there is no origin remote", async () => {
		const repo = mkRepo("dd-gaps-repo-");
		await $`git -C ${repo} init -q`;
		const result = await defaultBranchName(repo);
		expect(result).toBeNull();
	});
});

describe("getDiffFiles name-status parsing", () => {
	test("classifies renamed/added/deleted/modified/untracked from a real fixture", async () => {
		const repo = mkRepo("dd-gaps-repo-");
		await $`git -C ${repo} init -q`;
		await $`git -C ${repo} config user.email t@t.co`;
		await $`git -C ${repo} config user.name test`;
		writeFileSync(join(repo, "old.txt"), "line1\nline2\nline3\nline4\nline5\n");
		writeFileSync(join(repo, "mod.txt"), "keep\n");
		writeFileSync(join(repo, "del.txt"), "bye\n");
		await $`git -C ${repo} add old.txt mod.txt del.txt`;
		await $`git -C ${repo} commit -qm init`;

		await $`git -C ${repo} mv old.txt new.txt`;
		writeFileSync(join(repo, "mod.txt"), "keep\nmore\n");
		await $`rm ${join(repo, "del.txt")}`;
		writeFileSync(join(repo, "added.txt"), "added content\n");
		await $`git -C ${repo} add added.txt`;
		writeFileSync(join(repo, "extra.txt"), "untracked content\n");

		const files = await getDiffFiles(repo, { untracked: true });
		const byName = new Map(files.map((f) => [f.name, f]));

		const renamed = byName.get("new.txt");
		expect(renamed?.status).toBe("renamed");
		expect(renamed?.oldName).toBe("old.txt");

		expect(byName.get("added.txt")?.status).toBe("added");
		expect(byName.get("del.txt")?.status).toBe("deleted");
		expect(byName.get("mod.txt")?.status).toBe("modified");
		expect(byName.get("extra.txt")?.status).toBe("untracked");
	});
});
