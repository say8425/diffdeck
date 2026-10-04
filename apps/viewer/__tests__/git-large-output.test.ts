import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDiffFiles } from "../server/diff.ts";
import { repoFingerprint } from "../server/fingerprint.ts";
import { getRefs } from "../server/refs.ts";

// 64KB 넘는 출력을 내는 호출처마다 서버 함수를 동시에 여러 번 불러 Bun 1.3.x
// `$` never-settle 회귀를 잡는다 (testing.md). 동시 호출은
// 실제로 일어난다(선택이 다른 /api/diff·prewarm·watch 폴). for-each-ref는 좁은
// 출력 구간에서만 멈춰 8-way로는 잘 안 잡히므로 16-way로 겹친다. worktree
// list는 멈춤을 재현하지 못해 지키지 않는다. 픽스처는 `$` 대신 Bun.spawnSync로
// 만든다 — 1.3.x에서 셋업이 먼저 멈추면 안 된다.

// 각 호출의 출력이 64KB 파이프 버퍼를 넘어야 한다.
const STAGED = 1000;
const LOOSE = 1000;
const BRANCHES = 800; // for-each-ref 멈춤이 나는 좁은 구간(참조 600~800개) 안이다 — 바꾸면 판별력을 잃는다
const CALLS = 8;
const ROUNDS = 2;
const REF_CALLS = 16;
const REF_ROUNDS = 5;
const SETTLE_MS = 15_000;
/** 라운드마다 `settleWithin`이 먼저 터지도록 테스트 상한을 라운드 수에 맞춘다. */
const timeoutFor = (rounds: number): number => rounds * SETTLE_MS + 5_000;

const longName = (prefix: string, i: number): string =>
	`${prefix}-${String(i).padStart(4, "0")}-${"x".repeat(140)}`;

const git = (repo: string, args: string[], stdin?: string): void => {
	const r = Bun.spawnSync(["git", "-C", repo, ...args], {
		stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
		stdout: "ignore",
		stderr: "pipe",
	});
	if (r.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
	}
};

let repo: string;

beforeAll(() => {
	repo = mkdtempSync(join(tmpdir(), "cc-git-large-output-"));
	git(repo, ["init", "-q", "-b", "main"]);
	git(repo, ["config", "user.email", "t@t.co"]);
	git(repo, ["config", "user.name", "test"]);
	writeFileSync(join(repo, "seed.txt"), "seed\n");
	git(repo, ["add", "seed.txt"]);
	git(repo, ["commit", "-qm", "base"]);

	mkdirSync(join(repo, "staged"));
	mkdirSync(join(repo, "loose"));
	for (let i = 0; i < STAGED; i++) {
		writeFileSync(join(repo, "staged", longName("s", i)), `s${i}\n`);
	}
	for (let i = 0; i < LOOSE; i++) {
		writeFileSync(join(repo, "loose", longName("l", i)), `l${i}\n`);
	}
	git(repo, ["add", "staged"]);

	const lines = Array.from(
		{ length: BRANCHES },
		(_, i) => `create refs/heads/${longName("b", i)} HEAD\n`,
	).join("");
	git(repo, ["update-ref", "--stdin"], lines);
}, 60_000); // 훅의 기본 상한 5초는 부하가 걸리면 넘는다

afterAll(() => {
	rmSync(repo, { recursive: true, force: true });
});

const settleWithin = async <T>(work: Promise<T>, what: string): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(new Error(`${what}가 ${SETTLE_MS}ms 안에 settle하지 않았다`)),
			SETTLE_MS,
		);
	});
	try {
		return await Promise.race([work, deadline]);
	} finally {
		clearTimeout(timer);
	}
};

const concurrently = async <T>(
	what: string,
	fn: () => Promise<T>,
	{ calls = CALLS, rounds = ROUNDS } = {},
): Promise<T[]> => {
	const all: T[] = [];
	for (let round = 0; round < rounds; round++) {
		const batch = Array.from({ length: calls }, fn);
		all.push(...(await settleWithin(Promise.all(batch), what)));
	}
	return all;
};

test(
	"repoFingerprint settles under concurrent calls when `status -uall` exceeds 64KB",
	async () => {
		const prints = await concurrently("repoFingerprint", () =>
			repoFingerprint(repo, { untracked: true }),
		);
		expect(prints).toHaveLength(CALLS * ROUNDS);
		expect(new Set(prints).size).toBe(1);
	},
	timeoutFor(ROUNDS),
);

test(
	"getDiffFiles settles under concurrent calls when `diff --raw` exceeds 64KB",
	async () => {
		const results = await concurrently("getDiffFiles(diff --raw)", () =>
			getDiffFiles(repo),
		);
		for (const files of results) {
			expect(files).toHaveLength(STAGED);
			expect(files.every((f) => f.status === "added")).toBe(true);
		}
	},
	timeoutFor(ROUNDS),
);

test(
	"getDiffFiles settles under concurrent calls when `ls-files --others` exceeds 64KB",
	async () => {
		const results = await concurrently("getDiffFiles(ls-files)", () =>
			getDiffFiles(repo, { untracked: true }),
		);
		for (const files of results) {
			expect(files).toHaveLength(STAGED + LOOSE);
			expect(files.filter((f) => f.status === "untracked")).toHaveLength(LOOSE);
		}
	},
	timeoutFor(ROUNDS),
);

test(
	"getRefs settles under concurrent calls when `for-each-ref` exceeds 64KB",
	async () => {
		const results = await concurrently("getRefs", () => getRefs(repo), {
			calls: REF_CALLS,
			rounds: REF_ROUNDS,
		});
		for (const { refs } of results) {
			expect(refs.filter((r) => r.kind === "local")).toHaveLength(BRANCHES + 1);
		}
	},
	timeoutFor(REF_ROUNDS),
);
