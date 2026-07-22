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
		// 커밋 후 워킹트리는 clean — status만으로는 구분 불가, HEAD가 지문에
		// 포함되어야 base 모드 diff(커밋된 변경 포함)의 변화가 감지된다.
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
		// status 라인은 그대로("?? new.txt")여도 내용이 바뀌면 지문이 바뀌어야
		// 한다 — stat(mtime,size)이 이를 담당한다.
		writeFileSync(join(repo, "new.txt"), "fresh but different\n");
		const fp2 = await repoFingerprint(repo, { untracked: true });
		expect(fp2).not.toBe(fp1);
	});

	test("base mode: changes when the base ref moves", async () => {
		await $`git -C ${repo} branch -M main`;
		await $`git -C ${repo} checkout -qb feature`;
		writeFileSync(join(repo, "a.txt"), "feature\n");
		await $`git -C ${repo} add a.txt`;
		await $`git -C ${repo} commit -qm feat`;
		const fp1 = await repoFingerprint(repo, { mode: "base", ref: "main" });
		// main이 이동하면 merge-base가 달라질 수 있으므로 지문도 달라져야 한다.
		const head = (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
		await $`git -C ${repo} update-ref refs/heads/main ${head}`;
		const fp2 = await repoFingerprint(repo, { mode: "base", ref: "main" });
		expect(fp2).not.toBe(fp1);
	});
});
