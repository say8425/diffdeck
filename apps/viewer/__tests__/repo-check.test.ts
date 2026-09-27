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
//
// **사용자·시스템 gitconfig를 반드시 끊는다.** `safe.directory = *`가 어디든
// 있으면 git이 소유자 검사를 건너뛰어 이 테스트가 null을 받는다 — GitHub
// 러너가 정확히 그랬다(로컬은 초록, CI만 빨강). 설정 파일이 아니라 git의
// 기본 동작을 재는 테스트라 둘 다 비운다.
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
