import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { getDiffFiles } from "../server/diff.ts";

/**
 * 64KB 파이프 버퍼를 넘는 old 쪽 blob 여럿을 한 번에 읽는 경로의 회귀망.
 *
 * Bun 1.3.x(1.3.12·1.3.14 실측)의 `$`는 64KB를 넘는 stdout을 받는 호출에서
 * 자식이 이미 끝났는데도 promise가 영영 settle하지 않을 수 있다 — 겹치면
 * 거의 확정이고, 완전 순차여도 결국 걸린다(200KB × 32를 하나씩 읽어 14라운드째).
 * `getDiffFiles`의 8-way `showBytes` 버스트가 정확히 그 모양이라 큰 diff의
 * `/api/diff`가 45초 flight 타임아웃 → 503으로 떨어졌다(실측: 556파일 리포에서
 * 매번). 200KB 파일 12개면 첫 호출에서 죽고, 60KB(버퍼 미만)는 멀쩡하다.
 *
 * **판별력은 Bun 버전에 달렸다**: 업스트림이 1.4.0에서 고쳐, 1.4 이상에서는
 * `showBytes`를 `$`로 되돌려도 이 테스트가 통과한다(CI의 setup-bun은 버전
 * 미지정이라 최신을 쓴다). 1.3.x에서는 되돌리면 타임아웃으로 죽는다. 내용
 * 단언은 버전과 무관하게 큰 blob을 끝까지 읽는지를 지킨다.
 */

const FILES = 16;
const LINES = 2000; // 100바이트 × 2000줄 = 200KB — 64KB 버퍼의 세 배
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
