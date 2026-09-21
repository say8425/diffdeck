import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { createBlobCache } from "../server/blobCache.ts";
import { getDiffFiles } from "../server/diff.ts";

/**
 * `getDiffFiles`가 blob OID 캐시를 거칠 때의 정확성 계약. 각 테스트가 잡는 깨짐:
 * ① 캐시를 안 거치거나(hit 0) 워킹트리 new 쪽까지 캐시해 편집이 안 보이는 구현,
 * ② 이름(`HEAD`, 경로)으로 키를 잡아 커밋 직후 옛 내용을 내는 구현,
 * ③ 실패한 `git show`(빈 출력)를 저장해 빈 old 쪽이 눌러앉는 구현(head 모드에서만
 *   재현된다 — 해당 테스트 주석 참고),
 * ④ 캐시 경로가 다른 바이트를 내거나 head 모드 new 쪽을 캐시하지 않는 구현.
 */

let repo: string;

beforeEach(async () => {
	repo = mkdtempSync(join(tmpdir(), "cc-blob-cache-"));
	await $`git -C ${repo} init -q -b main`;
	await $`git -C ${repo} config user.email t@t.co`;
	await $`git -C ${repo} config user.name test`;
	writeFileSync(join(repo, "a.txt"), "v1\n");
	writeFileSync(join(repo, "b.txt"), "b1\n");
	await $`git -C ${repo} add -A`;
	await $`git -C ${repo} commit -qm init`;
});

afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
});

test("reuses the cached old side and still reads the new side from disk", async () => {
	const blobs = createBlobCache();
	writeFileSync(join(repo, "a.txt"), "v2\n");
	await getDiffFiles(repo, {}, blobs);
	expect(blobs.stats()).toMatchObject({ hits: 0, entries: 1 });

	writeFileSync(join(repo, "a.txt"), "v3\n");
	const [file] = await getDiffFiles(repo, {}, blobs);
	expect(blobs.stats().hits).toBe(1);
	expect(file?.oldContents).toBe("v1\n");
	expect(file?.newContents).toBe("v3\n");
});

test("after a commit moves HEAD, the old side follows the new HEAD blob", async () => {
	const blobs = createBlobCache();
	writeFileSync(join(repo, "a.txt"), "v2\n");
	await getDiffFiles(repo, {}, blobs);

	await $`git -C ${repo} commit -qam v2`;
	writeFileSync(join(repo, "a.txt"), "v3\n");
	const [file] = await getDiffFiles(repo, {}, blobs);
	expect(file?.oldContents).toBe("v2\n");
	expect(file?.newContents).toBe("v3\n");
});

// feat 브랜치: a.txt를 고치고 c.txt를 더한다. main은 움직이지 않으므로
// merge-base(main, feat) = main이고, head 모드 old 쪽 a.txt는 main의 "v1\n"이다.
const branchFeat = async (): Promise<void> => {
	await $`git -C ${repo} checkout -qb feat`;
	writeFileSync(join(repo, "a.txt"), "feat\n");
	writeFileSync(join(repo, "c.txt"), "new on feat\n");
	await $`git -C ${repo} add -A`;
	await $`git -C ${repo} commit -qm feat`;
	await $`git -C ${repo} checkout -q main`;
};
const HEAD_OPTS = { mode: "base" as const, ref: "main", head: "feat" };

test("a failed git show is not cached", async () => {
	// `git show`만 실패시키려면 목록이 그 blob을 읽지 않아야 한다. 워킹트리와
	// 비교하는 `git diff <rev>`는 old blob이 없으면 목록 단계에서 먼저 죽는다
	// (`fatal: unable to read …`, 실측). 커밋끼리 비교하는 head 모드는 트리의
	// OID만 보므로 목록은 나오고 `git show`만 실패한다.
	await branchFeat();
	const oid = (await $`git -C ${repo} rev-parse main:a.txt`.text()).trim();
	const loose = join(repo, ".git", "objects", oid.slice(0, 2), oid.slice(2));
	const blobs = createBlobCache();

	renameSync(loose, `${loose}.away`);
	const broken = (await getDiffFiles(repo, HEAD_OPTS, blobs)).find(
		(f) => f.name === "a.txt",
	);
	expect(broken?.oldContents).toBe(""); // 지금과 같은 동작: 그 빌드에만 빈 old 쪽
	expect(broken?.newContents).toBe("feat\n");
	// 읽힌 두 blob(a.txt new, c.txt new)만 저장되고 실패한 old 쪽은 빠진다.
	expect(blobs.stats().entries).toBe(2);

	renameSync(`${loose}.away`, loose);
	const healed = (await getDiffFiles(repo, HEAD_OPTS, blobs)).find(
		(f) => f.name === "a.txt",
	);
	expect(healed?.oldContents).toBe("v1\n");
});

test("head mode reads both sides through the cache and matches the uncached result", async () => {
	await branchFeat();
	const uncached = await getDiffFiles(repo, HEAD_OPTS);
	const blobs = createBlobCache();
	const first = await getDiffFiles(repo, HEAD_OPTS, blobs);
	const second = await getDiffFiles(repo, HEAD_OPTS, blobs);
	expect(first).toEqual(uncached);
	expect(second).toEqual(uncached);
	// a.txt: old·new 두 blob, c.txt: new 하나(추가라 old 없음) → 3개 저장,
	// 두 번째 빌드에서 셋 다 hit.
	expect(blobs.stats()).toMatchObject({ entries: 3, hits: 3 });
});
