import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 첫 빌드가 blob을 파일마다 `git show`로 읽지 않고 `cat-file --batch` **한 번**으로
 * 읽는가 — 프로세스 생성이 첫 로드를 지배했기 때문이다(raycast-extensions
 * 150파일: 387ms → 37ms, 실측). 잡는 깨짐: 선읽기를 빼먹어 다시 파일별로 읽는
 * 구현, 캐시가 이미 가진 blob까지 다시 배치로 읽는 구현, head 모드의 new 쪽을
 * 선읽기에서 빠뜨린 구현(워킹트리 모드만 보면 원리적으로 안 보인다 — 뮤테이션으로 확인).
 *
 * 결과만으로는 두 방식이 구별되지 않으므로(바이트가 같다) 실제로 뜬 git
 * 프로세스를 센다: 호출을 기록하는 git 심을 PATH 앞에 둔 **자식 bun**에서
 * `getDiffFiles`를 부른다. Bun.spawn은 실행 중에 바꾼 `process.env.PATH`를
 * 따르지 않아(실측) 같은 프로세스 안에서는 심이 안 걸린다.
 */

const FILES = 12;
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
	git(["add", "-A"]);
	git(["commit", "-qm", "init"]);
	// head 모드용: 파일을 모두 고친 커밋을 가진 브랜치. main은 움직이지 않는다.
	git(["checkout", "-qb", "feat"]);
	for (let i = 0; i < FILES; i++)
		writeFileSync(join(repo, `f${i}.txt`), `feat ${i}\n`);
	git(["commit", "-qam", "feat"]);
	git(["checkout", "-q", "main"]);
	for (let i = 0; i < FILES; i++)
		writeFileSync(join(repo, `f${i}.txt`), `v2 ${i}\n`);

	const realGit = Bun.which("git");
	if (!realGit) throw new Error("git not found");
	const shimDir = join(dir, "shim");
	Bun.spawnSync(["mkdir", "-p", shimDir]);
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

test("the shim sees the child's git calls (the test is not vacuous)", () => {
	expect(count(calls().cold, " diff --raw ")).toBe(1);
});

test("a cold build reads every old side in one cat-file --batch and no git show", () => {
	const { cold } = calls();
	expect(count(cold, " cat-file --batch")).toBe(1);
	expect(count(cold, " show ")).toBe(0);
	expect(result.cold).toEqual(
		Object.fromEntries(
			Array.from({ length: FILES }, (_, i) => [
				`f${i}.txt`,
				`v1 ${i}
`,
			]),
		),
	);
});

test("a warm build reads no blobs at all", () => {
	const { warm } = calls();
	expect(count(warm, " cat-file ")).toBe(0);
	expect(count(warm, " show ")).toBe(0);
	expect(result.warm).toBe(FILES);
});

test("head mode reads both sides of every file in the one batch too", () => {
	const { head } = calls();
	expect(count(head, " cat-file --batch")).toBe(1);
	expect(count(head, " show ")).toBe(0);
	expect(result.head.toSorted()).toEqual(
		Array.from({ length: FILES }, (_, i) => `feat ${i}\n`).toSorted(),
	);
});
