import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
	classifyRepo,
	type RepoCheckDeps,
	repoProblemResponse,
} from "../server/repoCheck.ts";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "repo-check-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("classifyRepo (real git)", () => {
	test("null for a working tree, including a subdirectory of one", async () => {
		const repo = join(root, "work");
		mkdirSync(join(repo, "sub"), { recursive: true });
		await $`git -C ${repo} init -q`;
		expect(await classifyRepo(repo)).toBeNull();
		expect(await classifyRepo(join(repo, "sub"))).toBeNull();
	});

	test("no-repo for an empty parameter", async () => {
		expect(await classifyRepo("")).toBe("no-repo");
	});

	test("repo-missing for a path that does not exist", async () => {
		expect(await classifyRepo(join(root, "gone"))).toBe("repo-missing");
	});

	test("not-a-repo for a plain directory and for a file", async () => {
		expect(await classifyRepo(root)).toBe("not-a-repo");
		const file = join(root, "f.txt");
		writeFileSync(file, "x");
		expect(await classifyRepo(file)).toBe("not-a-repo");
	});

	test("no-worktree for a bare repository", async () => {
		const bare = join(root, "bare.git");
		await $`git init -q --bare ${bare}`;
		expect(await classifyRepo(bare)).toBe("no-worktree");
	});
});

// git이 자기 테스트용으로 두는 스위치로 "소유자가 다르다"를 실제로 만든다
// (다른 사용자 계정 없이). 그 메시지에 safe.directory가 실린다는 것까지 실측이다.
describe("classifyRepo (dubious ownership)", () => {
	test("unsafe-repo, not not-a-repo, when git refuses the owner", async () => {
		const repo = join(root, "owned");
		await $`git init -q ${repo}`;
		const saved = process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
		process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = "1";
		try {
			expect(await classifyRepo(repo)).toBe("unsafe-repo");
		} finally {
			if (saved === undefined)
				delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
			else process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = saved;
		}
	});
});

describe("classifyRepo (injected)", () => {
	const deps = (revParse: RepoCheckDeps["revParse"]): RepoCheckDeps => ({
		exists: () => true,
		revParse,
	});

	test("git-unavailable when git cannot be spawned", async () => {
		const d = deps(() => Promise.reject(new Error("posix_spawn ENOENT")));
		expect(await classifyRepo("/x", d)).toBe("git-unavailable");
	});

	test("git-unavailable when the shell cannot find git", async () => {
		const d = deps(() =>
			Promise.resolve({ exitCode: 1, stdout: "", stderr: "" }),
		);
		expect(await classifyRepo("/x", d)).toBe("git-unavailable");
	});
});

describe("repoProblemResponse", () => {
	test("400 with the problem as the x-diff-error marker", async () => {
		const res = repoProblemResponse("repo-missing");
		expect(res.status).toBe(400);
		expect(res.headers.get("x-diff-error")).toBe("repo-missing");
		expect(await res.text()).toBe("no such directory");
	});

	test("keeps the legacy body for not-a-repo", async () => {
		expect(await repoProblemResponse("not-a-repo").text()).toBe(
			"not a git repository",
		);
	});
});
