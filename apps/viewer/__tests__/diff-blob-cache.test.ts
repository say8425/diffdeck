import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { type BlobCache, createBlobCache } from "../server/blobCache.ts";
import { getDiffFiles } from "../server/diff.ts";

// getDiffFiles가 blob OID 캐시를 거칠 때의 정확성 계약이다(server.md "blob 캐시").

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
	// head 모드에서 재현한다 — 워킹트리와 비교하는 git diff는 stat이 바뀐 파일의
	// old blob을 목록 단계에서 읽어 git show보다 먼저 죽는다. 커밋끼리 비교하면
	// 목록은 트리의 OID만 본다.
	await branchFeat();
	const oid = (await $`git -C ${repo} rev-parse main:a.txt`.text()).trim();
	const loose = join(repo, ".git", "objects", oid.slice(0, 2), oid.slice(2));
	const blobs = createBlobCache();

	renameSync(loose, `${loose}.away`);
	const broken = (await getDiffFiles(repo, HEAD_OPTS, blobs)).find(
		(f) => f.name === "a.txt",
	);
	expect(broken?.oldContents).toBe("");
	expect(broken?.newContents).toBe("feat\n");
	// 실패한 old 쪽은 빠지고 읽힌 new 쪽 둘(a.txt, c.txt)만 저장된다.
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
	expect(blobs.stats()).toMatchObject({ entries: 3, hits: 3 });
});

// 첫 캐시 미스(has든 get이든)에서 한 번 onMiss를 부른다. getDiffFiles는 목록을
// 뽑은 뒤에야 캐시를 보고 배치 선읽기 전에도 has를 부르므로, 여기서 ref를
// 움직이면 "목록과 읽기 사이에 ref가 움직인" 경합이 결정론적으로 생긴다.
const racingCache = (onMiss: () => void): BlobCache => {
	const inner = createBlobCache();
	let fired = false;
	const fire = (): void => {
		if (fired) return;
		fired = true;
		onMiss();
	};
	return {
		get(oid) {
			const hit = inner.get(oid);
			if (hit === undefined) fire();
			return hit;
		},
		has(oid) {
			const present = inner.has(oid);
			if (!present) fire();
			return present;
		},
		set: (oid, bytes) => inner.set(oid, bytes),
		stats: () => inner.stats(),
	};
};

const gitSync = (args: string[]): void => {
	const r = Bun.spawnSync(["git", "-C", repo, ...args], { stderr: "pipe" });
	if (r.exitCode !== 0)
		throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
};

const revParse = async (spec: string): Promise<string> =>
	(await $`git -C ${repo} rev-parse ${spec}`.text()).trim();

const text = (bytes: Uint8Array | undefined): string | undefined =>
	bytes === undefined ? undefined : new TextDecoder().decode(bytes);

test("HEAD moving between listing and reading does not store the new content under the old id", async () => {
	writeFileSync(join(repo, "a.txt"), "v2\n");
	const v1 = await revParse("HEAD:a.txt");
	const blobs = racingCache(() => gitSync(["commit", "-qam", "v2"]));
	const [file] = await getDiffFiles(repo, {}, blobs);
	expect(file?.oldContents).toBe("v1\n");
	expect(text(blobs.get(v1))).toBe("v1\n");
});

test("a head branch moving between listing and reading does not poison the cache", async () => {
	await branchFeat();
	const featA = await revParse("feat:a.txt");
	const blobs = racingCache(() => {
		gitSync(["checkout", "-q", "feat"]);
		writeFileSync(join(repo, "a.txt"), "feat moved on\n");
		gitSync(["commit", "-qam", "advance"]);
		gitSync(["checkout", "-q", "main"]);
	});
	const file = (await getDiffFiles(repo, HEAD_OPTS, blobs)).find(
		(f) => f.name === "a.txt",
	);
	expect(file?.newContents).toBe("feat\n");
	expect(text(blobs.get(featA))).toBe("feat\n");
});

test("keys entries by the full object id", async () => {
	writeFileSync(join(repo, "a.txt"), "v2\n");
	const blobs = createBlobCache();
	await getDiffFiles(repo, {}, blobs);
	const full = await revParse("HEAD:a.txt");
	expect(full).toHaveLength(40);
	expect(text(blobs.get(full))).toBe("v1\n");
});

test("an id the batch could not read falls back to reading by that id, never by name", async () => {
	// 목록이 볼 feat:a.txt blob을 지우고 목록 뒤에 feat을 전진시킨다 — 이름으로
	// 읽으면 전진한 내용이 읽혀 버린다.
	await branchFeat();
	gitSync(["checkout", "-q", "feat"]);
	writeFileSync(join(repo, "a.txt"), "feat moved on\n");
	gitSync(["commit", "-qam", "advance"]);
	const advanced = await revParse("feat");
	gitSync(["checkout", "-q", "main"]);
	gitSync(["update-ref", "refs/heads/feat", `${advanced}~1`]);
	const featA = await revParse("feat:a.txt");
	const loose = join(
		repo,
		".git",
		"objects",
		featA.slice(0, 2),
		featA.slice(2),
	);
	rmSync(loose);
	const blobs = racingCache(() =>
		gitSync(["update-ref", "refs/heads/feat", advanced]),
	);
	const file = (await getDiffFiles(repo, HEAD_OPTS, blobs)).find(
		(f) => f.name === "a.txt",
	);
	expect(file?.newContents).toBe("");
	expect(blobs.has(featA)).toBe(false);
});
