import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 결과 바이트로는 배치와 파일별 읽기가 갈리지 않아 실제로 뜬 git 프로세스를
// 센다. Bun.spawn은 실행 중에 바꾼 PATH를 따르지 않으므로 git 심을 PATH 앞에 둔
// 자식 bun에서 부른다(testing.md).

const FILES = 12;
// 배치 상한(PREFETCH_LIMITS)을 넘는 파일 하나 — 이것만 파일별 `git show`로 떨어져야 한다.
const BIG = "big.txt";
const bigBody = (tag: string): string =>
	`${tag}\n${`${"q".repeat(99)}\n`.repeat(12_000)}`;
const here = import.meta.dir;
let dir: string;
let repo: string;
let log: string;

const git = (args: string[]): void => {
	const r = Bun.spawnSync(["git", "-C", repo, ...args], { stderr: "pipe" });
	if (r.exitCode !== 0)
		throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
};

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "cc-blob-batch-"));
	repo = join(dir, "repo");
	Bun.spawnSync(["git", "init", "-q", "-b", "main", repo]);
	git(["config", "user.email", "t@t.co"]);
	git(["config", "user.name", "test"]);
	for (let i = 0; i < FILES; i++)
		writeFileSync(join(repo, `f${i}.txt`), `v1 ${i}\n`);
	writeFileSync(join(repo, BIG), bigBody("v1"));
	git(["add", "-A"]);
	git(["commit", "-qm", "init"]);
	git(["checkout", "-qb", "feat"]);
	for (let i = 0; i < FILES; i++)
		writeFileSync(join(repo, `f${i}.txt`), `feat ${i}\n`);
	git(["commit", "-qam", "feat"]);
	git(["checkout", "-q", "main"]);
	for (let i = 0; i < FILES; i++)
		writeFileSync(join(repo, `f${i}.txt`), `v2 ${i}\n`);
	writeFileSync(join(repo, BIG), bigBody("v2"));

	const realGit = Bun.which("git");
	if (!realGit) throw new Error("git not found");
	const shimDir = join(dir, "shim");
	mkdirSync(shimDir);
	writeFileSync(
		join(shimDir, "git"),
		`#!/bin/sh\necho "$*" >> "$GIT_SHIM_LOG"\nexec "${realGit}" "$@"\n`,
	);
	chmodSync(join(shimDir, "git"), 0o755);
	log = join(dir, "git.log");

	const script = join(dir, "run.ts");
	writeFileSync(
		script,
		`import { appendFileSync } from "node:fs";
import { createBlobCache } from ${JSON.stringify(join(here, "../server/blobCache.ts"))};
import { getDiffFiles } from ${JSON.stringify(join(here, "../server/diff.ts"))};
const blobs = createBlobCache();
const cold = await getDiffFiles(${JSON.stringify(repo)}, {}, blobs);
appendFileSync(process.env.GIT_SHIM_LOG, "--- warm\\n");
const warm = await getDiffFiles(${JSON.stringify(repo)}, {}, blobs);
appendFileSync(process.env.GIT_SHIM_LOG, "--- head\\n");
const head = await getDiffFiles(${JSON.stringify(repo)}, { mode: "base", ref: "main", head: "feat" }, createBlobCache());
console.log(JSON.stringify({ cold: Object.fromEntries(cold.map((f) => [f.name, f.oldContents])), warm: warm.length, head: head.map((f) => f.newContents) }));
`,
	);
	const r = Bun.spawnSync(["bun", script], {
		env: {
			...process.env,
			PATH: `${shimDir}:${process.env.PATH}`,
			GIT_SHIM_LOG: log,
		},
		stderr: "pipe",
	});
	if (r.exitCode !== 0) throw new Error(r.stderr.toString());
	result = JSON.parse(r.stdout.toString()) as typeof result;
}, 30_000);

let result: { cold: Record<string, string>; warm: number; head: string[] };

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

const calls = (): { cold: string[]; warm: string[]; head: string[] } => {
	const lines = readFileSync(log, "utf8").trim().split("\n");
	const warmAt = lines.indexOf("--- warm");
	const headAt = lines.indexOf("--- head");
	return {
		cold: lines.slice(0, warmAt),
		warm: lines.slice(warmAt + 1, headAt),
		head: lines.slice(headAt + 1),
	};
};
const count = (lines: string[], sub: string): number =>
	lines.filter((l) => l.includes(sub)).length;
// `cat-file --batch`와 `cat-file --batch-check`를 가른다(부분 문자열로 세면 섞인다).
const batches = (lines: string[]): number =>
	lines.filter((l) => l.endsWith("cat-file --batch")).length;
const sizeChecks = (lines: string[]): number =>
	lines.filter((l) => l.endsWith("cat-file --batch-check")).length;

test("the shim sees the child's git calls (the test is not vacuous)", () => {
	expect(count(calls().cold, " diff --raw ")).toBe(1);
});

test("a cold build reads small old sides in one batch and only the big one by itself", () => {
	const { cold } = calls();
	expect(sizeChecks(cold)).toBe(1);
	expect(batches(cold)).toBe(1);
	expect(count(cold, " show ")).toBe(1);
	expect(result.cold).toEqual({
		...Object.fromEntries(
			Array.from({ length: FILES }, (_, i) => [`f${i}.txt`, `v1 ${i}\n`]),
		),
		[BIG]: bigBody("v1"),
	});
});

test("a warm build reads no blobs at all", () => {
	const { warm } = calls();
	expect(count(warm, " cat-file ")).toBe(0);
	expect(count(warm, " show ")).toBe(0);
	expect(result.warm).toBe(FILES + 1);
});

test("head mode reads both sides of every file in the one batch too", () => {
	const { head } = calls();
	expect(batches(head)).toBe(1);
	expect(count(head, " show ")).toBe(0);
	expect(result.head.toSorted()).toEqual(
		Array.from({ length: FILES }, (_, i) => `feat ${i}\n`).toSorted(),
	);
});
