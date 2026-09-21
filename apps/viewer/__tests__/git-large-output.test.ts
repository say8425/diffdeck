import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDiffFiles } from "../server/diff.ts";
import { repoFingerprint } from "../server/fingerprint.ts";
import { getRefs } from "../server/refs.ts";

/**
 * 출력이 64KB를 넘는 git 호출이 서버 함수를 **동시에** 여러 번 불러도 settle하는가.
 * Bun 1.3.x의 `$`는 그런 호출에서 자식이 끝났는데도 promise가 영영 settle하지 않을
 * 수 있고, 호출이 겹치면 거의 확정이다(업스트림은 1.4.0에서 수정). 동시 호출은
 * 실제로 일어난다 — 선택이 다른 `/api/diff` 요청들, prewarm, watch 폴이 서로 다른
 * flight 키로 겹친다.
 *
 * 한 케이스가 한 호출처를 지킨다: 지문의 `status -uall`, `getDiffFiles`의
 * `diff --name-status`와 `ls-files --others`, `getRefs`의 `for-each-ref`. 앞의
 * 셋은 `$`로 돌아가면 첫 라운드에 확정적으로 죽는다(1.3.12, 각 3/3 실측 —
 * `ls-files` 케이스는 `name-status`도 거치므로 그걸 되돌려도 함께 죽는다).
 *
 * **`for-each-ref` 케이스만 확률적이다.** 이 호출의 멈춤은 좁은 구간에서만
 * 나고(8-way에서 참조 600~800개 ≈ 180~240KB — 400개 이하나 2000개에서는 30라운드
 * 동안 한 번도 안 멈췄다), 그 구간에서도 라운드마다 확률이다. 그래서 800개로
 * 라운드를 늘려 돌린다 — 그래도 되돌린 코드를 5번 중 3번만 잡았으니(1.3.12)
 * 이 케이스의 초록을 증거로 받지 말 것.
 *
 * 판별력은 `diff-large-blob.test.ts`와 같다: 행업 단언은 1.3.x에서만 갈리므로 CI의
 * `test-bun13` 잡이 이 파일도 Bun 1.3.14로 돌린다. 개수 단언은 버전 무관. 그 잡은
 * 설치 없이 돌므로 픽스처도 `$` 대신 `Bun.spawnSync`로 만든다 — 1.3.x에서 셋업이
 * 먼저 멈추면 무엇을 재는지 흐려진다.
 */

const STAGED = 1000; // 이름 150자 × 1000 → name-status ~160KB
const LOOSE = 1000; // → ls-files --others ~157KB, status -uall은 둘을 합쳐 ~320KB
const BRANCHES = 800; // → for-each-ref ~256KB
const CALLS = 8;
const ROUNDS = 2;
const REF_ROUNDS = 20; // getRefs만 — 위 docblock 참고
const SETTLE_MS = 15_000;
const TIMEOUT = ROUNDS * SETTLE_MS + 5_000;

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
});

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

/** `fn`을 `CALLS`번 동시에 부르는 라운드를 `rounds`번 돌려 모든 결과를 모은다. */
const concurrently = async <T>(
	what: string,
	fn: () => Promise<T>,
	rounds = ROUNDS,
): Promise<T[]> => {
	const all: T[] = [];
	for (let round = 0; round < rounds; round++) {
		const batch = Array.from({ length: CALLS }, fn);
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
	TIMEOUT,
);

test(
	"getDiffFiles settles under concurrent calls when `diff --name-status` exceeds 64KB",
	async () => {
		const results = await concurrently("getDiffFiles(name-status)", () =>
			getDiffFiles(repo),
		);
		for (const files of results) {
			expect(files).toHaveLength(STAGED);
			expect(files.every((f) => f.status === "added")).toBe(true);
		}
	},
	TIMEOUT,
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
	TIMEOUT,
);

test(
	"getRefs settles under concurrent calls when `for-each-ref` exceeds 64KB",
	async () => {
		const results = await concurrently(
			"getRefs",
			() => getRefs(repo),
			REF_ROUNDS,
		);
		for (const { refs } of results) {
			// 만든 브랜치 800개 + main
			expect(refs.filter((r) => r.kind === "local")).toHaveLength(BRANCHES + 1);
		}
	},
	TIMEOUT,
);
