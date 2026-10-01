import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { getDiffFiles } from "../server/diff.ts";

// 큰 old 쪽 blob 여럿을 끝까지 바이트 그대로 읽는지만 지킨다. old 쪽은 cat-file --batch 한 번이라
// 행업은 판별하지 못하고, 그 `$` 회귀는 git-cat-file-batch.test.ts가 잡는다(testing.md).

const FILES = 16;
const LINES = 2000; // 한 blob이 64KB 파이프 버퍼를 넘어야 한다
const ROUNDS = 3;
const SETTLE_MS = 10_000;

const original = (name: string): string =>
	`${name}\n${`${"x".repeat(99)}\n`.repeat(LINES)}`;

let repo: string;

beforeEach(async () => {
	repo = mkdtempSync(join(tmpdir(), "cc-large-blob-"));
	await $`git -C ${repo} init -q`;
	await $`git -C ${repo} config user.email t@t.co`;
	await $`git -C ${repo} config user.name test`;
	for (let i = 0; i < FILES; i++) {
		const name = `big${i}.txt`;
		writeFileSync(join(repo, name), original(name));
	}
	await $`git -C ${repo} add -A`;
	await $`git -C ${repo} commit -qm base`;
	for (let i = 0; i < FILES; i++) {
		const name = `big${i}.txt`;
		writeFileSync(join(repo, name), `${original(name)}tail\n`);
	}
});

afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
});

const settleWithin = async <T>(work: Promise<T>, ms: number): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`getDiffFiles가 ${ms}ms 안에 settle하지 않았다`)),
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
	"reads many >64KB old-side blobs to the end, repeatedly, without hanging",
	async () => {
		for (let round = 0; round < ROUNDS; round++) {
			const files = await settleWithin(getDiffFiles(repo), SETTLE_MS);
			expect(files).toHaveLength(FILES);
			for (const f of files) {
				expect(f.status).toBe("modified");
				expect(f.oldContents.length).toBe(f.name.length + 1 + 100 * LINES);
				expect(f.oldContents).toBe(original(f.name));
				expect(f.newContents).toBe(`${original(f.name)}tail\n`);
			}
		}
	},
	ROUNDS * SETTLE_MS + 5_000,
);
