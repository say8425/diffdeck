import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { repoFingerprint } from "../server/fingerprint.ts";

let repo: string;

beforeEach(async () => {
	repo = mkdtempSync(join(tmpdir(), "cc-fp-"));
	await $`git -C ${repo} init -q`;
	await $`git -C ${repo} config user.email t@t.co`;
	await $`git -C ${repo} config user.name test`;
	writeFileSync(join(repo, "a.txt"), "one\n");
	await $`git -C ${repo} add a.txt`;
	await $`git -C ${repo} commit -qm init`;
});

afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
});

describe("repoFingerprint", () => {
	// 다른 head 테스트만으로도 라인 커버리지는 초록이라(게이트는 branch를 안
	// 센다) 이 시나리오는 따로 찌른다.
	test("a moving head branch changes the fingerprint", async () => {
		await $`git -C ${repo} checkout -qb feat`;
		writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
		await $`git -C ${repo} commit -qam feat`;
		await $`git -C ${repo} checkout -q -`;

		const before = await repoFingerprint(repo, { head: "feat" });

		await $`git -C ${repo} checkout -q feat`;
		writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");
		await $`git -C ${repo} commit -qam more`;
		await $`git -C ${repo} checkout -q -`;

		expect(await repoFingerprint(repo, { head: "feat" })).not.toBe(before);
	});

	test("is non-empty and stable while nothing changes", async () => {
		const fp1 = await repoFingerprint(repo);
		const fp2 = await repoFingerprint(repo);
		expect(fp1).toBeTruthy();
		expect(fp2).toBe(fp1);
	});

	test("changes when a tracked file is edited, and again on further edits", async () => {
		const fp1 = await repoFingerprint(repo);
		writeFileSync(join(repo, "a.txt"), "two\n");
		const fp2 = await repoFingerprint(repo);
		expect(fp2).not.toBe(fp1);
		writeFileSync(join(repo, "a.txt"), "three\n");
		const fp3 = await repoFingerprint(repo);
		expect(fp3).not.toBe(fp2);
	});

	test("changes when a tracked file is deleted", async () => {
		const fp1 = await repoFingerprint(repo);
		rmSync(join(repo, "a.txt"));
		const fp2 = await repoFingerprint(repo);
		expect(fp2).not.toBe(fp1);
	});

	test("changes when a commit moves HEAD even with a clean tree", async () => {
		const fp1 = await repoFingerprint(repo);
		writeFileSync(join(repo, "a.txt"), "two\n");
		await $`git -C ${repo} add a.txt`;
		await $`git -C ${repo} commit -qm second`;
		const fp2 = await repoFingerprint(repo);
		expect(fp2).not.toBe(fp1);
	});

	test("untracked files affect the fingerprint only when untracked=true", async () => {
		const offBefore = await repoFingerprint(repo, { untracked: false });
		const onBefore = await repoFingerprint(repo, { untracked: true });
		writeFileSync(join(repo, "new.txt"), "fresh\n");
		const offAfter = await repoFingerprint(repo, { untracked: false });
		const onAfter = await repoFingerprint(repo, { untracked: true });
		expect(offAfter).toBe(offBefore);
		expect(onAfter).not.toBe(onBefore);
	});

	test("detects edits to an already-listed untracked file", async () => {
		writeFileSync(join(repo, "new.txt"), "fresh\n");
		const fp1 = await repoFingerprint(repo, { untracked: true });
		// status 줄("?? new.txt")은 그대로라 stat(mtime·size)만이 이 변화를 잡는다.
		writeFileSync(join(repo, "new.txt"), "fresh but different\n");
		const fp2 = await repoFingerprint(repo, { untracked: true });
		expect(fp2).not.toBe(fp1);
	});

	test("a staged rename changes the fingerprint, and edits to the renamed file keep being detected", async () => {
		const fp1 = await repoFingerprint(repo);
		await $`git -C ${repo} mv a.txt b.txt`;
		const fp2 = await repoFingerprint(repo);
		expect(fp2).not.toBe(fp1);
		writeFileSync(join(repo, "b.txt"), "renamed edit one\n");
		const fp3 = await repoFingerprint(repo);
		expect(fp3).not.toBe(fp2);
		// 두 번째 편집부터는 status 출력(RM)이 그대로라, -z rename 토큰 스킵이 새
		// 경로를 stat해야만 잡힌다.
		writeFileSync(join(repo, "b.txt"), "renamed edit two, longer\n");
		const fp4 = await repoFingerprint(repo);
		expect(fp4).not.toBe(fp3);
	});

	test("base mode: changes when the base ref moves", async () => {
		await $`git -C ${repo} branch -M main`;
		await $`git -C ${repo} checkout -qb feature`;
		writeFileSync(join(repo, "a.txt"), "feature\n");
		await $`git -C ${repo} add a.txt`;
		await $`git -C ${repo} commit -qm feat`;
		const fp1 = await repoFingerprint(repo, { mode: "base", ref: "main" });
		const head = (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
		await $`git -C ${repo} update-ref refs/heads/main ${head}`;
		const fp2 = await repoFingerprint(repo, { mode: "base", ref: "main" });
		expect(fp2).not.toBe(fp1);
	});
});
