import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { gitRun, gitText } from "../server/gitOutput.ts";
import { mapWithLimit } from "../server/mapLimit.ts";

/**
 * `gitText`(와 그 아래 `gitBytes`)의 회귀망. 출력이 64KB를 넘을 수 있는 서버의
 * git 호출은 전부 이 헬퍼를 탄다 — Bun 1.3.x의 `$`는 그런 호출에서 자식이
 * 끝났는데도 promise가 영영 settle하지 않을 수 있기 때문이다(업스트림은 1.4.0에서
 * 수정). 호출처별 회귀망은 `git-large-output.test.ts`인데 거기서 지키지 못하는
 * 호출처가 있어(`summary.ts`의 순차 호출과 `worktree list`는 멈춤을 재현하지
 * 못했다), 확실히 걸리는 모양 — 200KB `git show` 12개를 8-way로 — 으로 헬퍼 자체를
 * 찌른다.
 *
 * 판별력은 `diff-large-blob.test.ts`와 같다: 행업 단언은 1.3.x에서만 갈리므로
 * CI의 `test-bun13` 잡이 이 파일도 Bun 1.3.14로 돌린다. 내용 단언은 버전 무관.
 */

const FILES = 12;
const LINES = 2000; // 100바이트 × 2000줄 = 200KB — 64KB 버퍼의 세 배
const ROUNDS = 3;
const SETTLE_MS = 10_000;

const content = (name: string): string =>
	`${name}\n${`${"y".repeat(99)}\n`.repeat(LINES)}`;

let repo: string;

beforeEach(async () => {
	repo = mkdtempSync(join(tmpdir(), "cc-git-output-"));
	await $`git -C ${repo} init -q`;
	await $`git -C ${repo} config user.email t@t.co`;
	await $`git -C ${repo} config user.name test`;
	for (let i = 0; i < FILES; i++) {
		const name = `big${i}.txt`;
		writeFileSync(join(repo, name), content(name));
	}
	writeFileSync(join(repo, "한글.txt"), "안녕 — 세계\n");
	await $`git -C ${repo} add -A`;
	await $`git -C ${repo} commit -qm base`;
});

afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
});

const settleWithin = async <T>(work: Promise<T>, ms: number): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(new Error(`gitText 버스트가 ${ms}ms 안에 settle하지 않았다`)),
			ms,
		);
	});
	try {
		return await Promise.race([work, deadline]);
	} finally {
		clearTimeout(timer);
	}
};

test(
	"reads many >64KB outputs to the end, concurrently and repeatedly, without hanging",
	async () => {
		const names = Array.from({ length: FILES }, (_, i) => `big${i}.txt`);
		for (let round = 0; round < ROUNDS; round++) {
			const texts = await settleWithin(
				mapWithLimit(names, 8, (name) =>
					gitText(["-C", repo, "show", `HEAD:${name}`]),
				),
				SETTLE_MS,
			);
			for (const [i, text] of texts.entries()) {
				const name = `big${i}.txt`;
				expect(text.length).toBe(name.length + 1 + 100 * LINES);
				expect(text).toBe(content(name));
			}
		}
	},
	ROUNDS * SETTLE_MS + 5_000,
);

test("decodes stdout as UTF-8", async () => {
	expect(await gitText(["-C", repo, "show", "HEAD:한글.txt"])).toBe(
		"안녕 — 세계\n",
	);
});

test("ignores the exit code: a missing rev:path yields an empty string", async () => {
	expect(await gitText(["-C", repo, "show", "HEAD:nope.txt"])).toBe("");
});

test("gitRun reports exit code 0 with the bytes on success", async () => {
	const { stdout, exitCode } = await gitRun([
		"-C",
		repo,
		"show",
		"HEAD:한글.txt",
	]);
	expect(exitCode).toBe(0);
	expect(new TextDecoder().decode(stdout)).toBe("안녕 — 세계\n");
});

test("gitRun reports a non-zero exit code when git fails", async () => {
	const { stdout, exitCode } = await gitRun([
		"-C",
		repo,
		"show",
		"HEAD:nope.txt",
	]);
	expect(exitCode).not.toBe(0);
	expect(stdout.byteLength).toBe(0);
});
