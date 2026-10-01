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

// GIT_TEST_ASSUME_DIFFERENT_OWNER는 다른 계정 없이 소유자 불일치를 만드는 git의
// 테스트용 스위치다. 사용자·시스템 gitconfig는 끊는다 — 어디든 `safe.directory
// = *`가 있으면(GitHub 러너) 소유자 검사를 건너뛴다.
const ISOLATED_OWNER_ENV = {
	GIT_TEST_ASSUME_DIFFERENT_OWNER: "1",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
};

describe("classifyRepo (dubious ownership)", () => {
	test("unsafe-repo, not not-a-repo, when git refuses the owner", async () => {
		const repo = join(root, "owned");
		await $`git init -q ${repo}`;
		const saved = Object.fromEntries(
			Object.keys(ISOLATED_OWNER_ENV).map((k) => [k, process.env[k]]),
		);
		Object.assign(process.env, ISOLATED_OWNER_ENV);
		try {
			expect(await classifyRepo(repo)).toBe("unsafe-repo");
		} finally {
			for (const [k, v] of Object.entries(saved)) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
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
