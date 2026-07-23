import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
	getDiffFiles,
	getFileBytes,
	isGitRepo,
	resolveBaseRef,
} from "../server/diff.ts";

let repo: string;

beforeEach(async () => {
	repo = mkdtempSync(join(tmpdir(), "cc-diff-"));
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

describe("isGitRepo", () => {
	test("true for a repo, false for a plain dir", async () => {
		expect(await isGitRepo(repo)).toBe(true);
		const plain = mkdtempSync(join(tmpdir(), "cc-plain-"));
		expect(await isGitRepo(plain)).toBe(false);
		rmSync(plain, { recursive: true, force: true });
	});
});

describe("getDiffFiles", () => {
	test("modified file carries full old and new contents", async () => {
		const lines = `${Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join(
			"\n",
		)}\n`;
		writeFileSync(join(repo, "a.txt"), lines);
		await $`git -C ${repo} add a.txt`;
		await $`git -C ${repo} commit -qm sixty`;
		writeFileSync(join(repo, "a.txt"), lines.replace("line1\n", "LINE1\n"));
		const files = await getDiffFiles(repo);
		expect(files).toHaveLength(1);
		const f = files[0];
		expect(f.name).toBe("a.txt");
		expect(f.status).toBe("modified");
		expect(f.binary).toBe(false);
		expect(f.oldContents).toContain("line1\n");
		expect(f.newContents).toContain("LINE1\n");
		// full content: an unchanged middle line is present in both
		expect(f.oldContents).toContain("line30");
		expect(f.newContents).toContain("line30");
	});

	test("deleted file has empty newContents", async () => {
		rmSync(join(repo, "a.txt"));
		const files = await getDiffFiles(repo);
		expect(files[0].status).toBe("deleted");
		expect(files[0].oldContents).toBe("one\n");
		expect(files[0].newContents).toBe("");
	});

	test("untracked included only with opt-in, as status untracked", async () => {
		writeFileSync(join(repo, "b.txt"), "brand new\n");
		const without = await getDiffFiles(repo, { untracked: false });
		expect(without.find((f) => f.name === "b.txt")).toBeUndefined();
		const withUntracked = await getDiffFiles(repo, { untracked: true });
		const b = withUntracked.find((f) => f.name === "b.txt");
		expect(b?.status).toBe("untracked");
		expect(b?.oldContents).toBe("");
		expect(b?.newContents).toBe("brand new\n");
	});

	test("binary file is flagged with empty contents", async () => {
		writeFileSync(join(repo, "bin.dat"), Buffer.from([0x41, 0x00, 0x42]));
		const files = await getDiffFiles(repo, { untracked: true });
		const bin = files.find((f) => f.name === "bin.dat");
		expect(bin?.binary).toBe(true);
		expect(bin?.oldContents).toBe("");
		expect(bin?.newContents).toBe("");
	});

	test("binary file carries a blobVersion that changes with its bytes", async () => {
		writeFileSync(join(repo, "img.dat"), Buffer.from([0x89, 0x00, 0x01]));
		let files = await getDiffFiles(repo, { untracked: true });
		const v1 = files.find((f) => f.name === "img.dat")?.blobVersion;
		expect(v1).toBeTruthy();
		writeFileSync(join(repo, "img.dat"), Buffer.from([0x89, 0x00, 0x02]));
		files = await getDiffFiles(repo, { untracked: true });
		const v2 = files.find((f) => f.name === "img.dat")?.blobVersion;
		expect(v2).toBeTruthy();
		expect(v2).not.toBe(v1);
	});

	test("text file has no blobVersion", async () => {
		writeFileSync(join(repo, "a.txt"), "changed\n");
		const files = await getDiffFiles(repo);
		expect(files[0]?.blobVersion).toBeUndefined();
	});

	test("every file carries a contentVersion that tracks its contents", async () => {
		writeFileSync(join(repo, "a.txt"), "changed\n");
		writeFileSync(join(repo, "bin.dat"), Buffer.from([0x41, 0x00]));
		const first = await getDiffFiles(repo, { untracked: true });
		for (const f of first) expect(f.contentVersion).toBeTruthy();
		// 무변경 재실행 → 동일 (클라이언트 파싱 캐시의 키가 되므로 안정적이어야 한다)
		const again = await getDiffFiles(repo, { untracked: true });
		expect(again.map((f) => f.contentVersion)).toEqual(
			first.map((f) => f.contentVersion),
		);
		// 내용 변경 → 해당 파일만 변화
		writeFileSync(join(repo, "a.txt"), "changed more\n");
		const after = await getDiffFiles(repo, { untracked: true });
		const before = new Map(first.map((f) => [f.name, f.contentVersion]));
		expect(after.find((f) => f.name === "a.txt")?.contentVersion).not.toBe(
			before.get("a.txt"),
		);
		expect(after.find((f) => f.name === "bin.dat")?.contentVersion).toBe(
			before.get("bin.dat"),
		);
	});
});

describe("getDiffFiles non-ASCII and special filenames", () => {
	// git의 기본값(core.quotePath=true)에서는 -z 없는 --name-status/ls-files가
	// 비-ASCII·특수문자 경로를 큰따옴표+8진 이스케이프로 인용해서 낸다
	// (예: 한글.txt → "\355\225\234\352\270\200.txt"). 그 인용 문자열을 그대로
	// 경로로 쓰면 git show/readFileSync가 못 찾아 내용이 빈 채로 렌더된다.
	test("modified file with a Korean filename carries full contents", async () => {
		const name = "한글.txt";
		writeFileSync(join(repo, name), "one\n");
		await $`git -C ${repo} add ${name}`;
		await $`git -C ${repo} commit -qm korean`;
		writeFileSync(join(repo, name), "two\n");
		const files = await getDiffFiles(repo);
		const f = files.find((x) => x.name === name);
		expect(f).toBeDefined();
		expect(f?.status).toBe("modified");
		expect(f?.oldContents).toBe("one\n");
		expect(f?.newContents).toBe("two\n");
	});

	test("added file with a Korean filename carries new contents", async () => {
		const name = "추가.txt";
		writeFileSync(join(repo, name), "brand new\n");
		await $`git -C ${repo} add ${name}`;
		const files = await getDiffFiles(repo);
		const f = files.find((x) => x.name === name);
		expect(f?.status).toBe("added");
		expect(f?.newContents).toBe("brand new\n");
	});

	test("deleted file with a Korean filename carries old contents", async () => {
		const name = "삭제.txt";
		writeFileSync(join(repo, name), "gone soon\n");
		await $`git -C ${repo} add ${name}`;
		await $`git -C ${repo} commit -qm korean-delete`;
		rmSync(join(repo, name));
		const files = await getDiffFiles(repo);
		const f = files.find((x) => x.name === name);
		expect(f?.status).toBe("deleted");
		expect(f?.oldContents).toBe("gone soon\n");
		expect(f?.newContents).toBe("");
	});

	test("renamed file (ASCII to Korean) carries oldName and full contents", async () => {
		const renamed = "이름변경.txt";
		writeFileSync(join(repo, "old-name.txt"), "rename me\n");
		await $`git -C ${repo} add old-name.txt`;
		await $`git -C ${repo} commit -qm before-rename`;
		// Bun의 $ 셸은 템플릿 리터럴에 직접 박힌(보간되지 않은) 비-ASCII 텍스트를
		// 깨뜨리므로 ${} 보간으로 전달해야 한다 (이 자체가 diff.ts 파싱과는 무관한
		// Bun 셸 인용 이슈).
		await $`git -C ${repo} mv old-name.txt ${renamed}`;
		const files = await getDiffFiles(repo);
		const f = files.find((x) => x.name === renamed);
		expect(f?.status).toBe("renamed");
		expect(f?.oldName).toBe("old-name.txt");
		expect(f?.oldContents).toBe("rename me\n");
		expect(f?.newContents).toBe("rename me\n");
	});

	test("untracked file with a unicode filename carries new contents", async () => {
		const name = "ünïcode.txt";
		writeFileSync(join(repo, name), "fresh\n");
		const files = await getDiffFiles(repo, { untracked: true });
		const f = files.find((x) => x.name === name);
		expect(f?.status).toBe("untracked");
		expect(f?.newContents).toBe("fresh\n");
	});

	test("modified file with a space in its filename still works (regression guard)", async () => {
		const name = "my file.txt";
		writeFileSync(join(repo, name), "one\n");
		await $`git -C ${repo} add ${name}`;
		await $`git -C ${repo} commit -qm spacey`;
		writeFileSync(join(repo, name), "two\n");
		const files = await getDiffFiles(repo);
		const f = files.find((x) => x.name === name);
		expect(f?.oldContents).toBe("one\n");
		expect(f?.newContents).toBe("two\n");
	});
});

describe("getFileBytes", () => {
	test("side=new reads the working tree, side=old reads the committed bytes", async () => {
		writeFileSync(join(repo, "img.bin"), Buffer.from([1, 0, 1]));
		await $`git -C ${repo} add img.bin`;
		await $`git -C ${repo} commit -qm img`;
		writeFileSync(join(repo, "img.bin"), Buffer.from([2, 0, 2, 2]));
		const oldBytes = await getFileBytes(repo, "img.bin", "old");
		const newBytes = await getFileBytes(repo, "img.bin", "new");
		expect(Array.from(oldBytes ?? [])).toEqual([1, 0, 1]);
		expect(Array.from(newBytes ?? [])).toEqual([2, 0, 2, 2]);
	});

	test("missing side returns null (old of untracked, new of deleted)", async () => {
		writeFileSync(join(repo, "new.bin"), Buffer.from([3, 0]));
		expect(await getFileBytes(repo, "new.bin", "old")).toBeNull();
		rmSync(join(repo, "a.txt"));
		expect(await getFileBytes(repo, "a.txt", "new")).toBeNull();
	});

	test("rejects paths escaping the repo and the empty path", async () => {
		expect(await getFileBytes(repo, "../outside.txt", "new")).toBeNull();
		expect(await getFileBytes(repo, "/etc/passwd", "new")).toBeNull();
		// 빈 경로가 side=old에서 `git show <rev>:`(트리 목록)로 새지 않아야 한다.
		expect(await getFileBytes(repo, "", "old")).toBeNull();
	});

	test("mode=base reads the merge-base version for side=old", async () => {
		await $`git -C ${repo} branch -M main`;
		writeFileSync(join(repo, "pic.bin"), Buffer.from([9, 0]));
		await $`git -C ${repo} add pic.bin`;
		await $`git -C ${repo} commit -qm base-img`;
		await $`git -C ${repo} checkout -qb feature`;
		writeFileSync(join(repo, "pic.bin"), Buffer.from([8, 0, 8]));
		await $`git -C ${repo} add pic.bin`;
		await $`git -C ${repo} commit -qm feat-img`;
		// Committed on the feature branch: vs HEAD the old side is the branch
		// commit, but vs base (main) it must be the merge-base version.
		const vsHead = await getFileBytes(repo, "pic.bin", "old");
		const vsBase = await getFileBytes(repo, "pic.bin", "old", {
			mode: "base",
			ref: "main",
		});
		expect(Array.from(vsHead ?? [])).toEqual([8, 0, 8]);
		expect(Array.from(vsBase ?? [])).toEqual([9, 0]);
	});
});

describe("resolveBaseRef", () => {
	test("falls back to the local default branch when no PR/remote", async () => {
		await $`git -C ${repo} branch -M main`;
		const { base, ref } = await resolveBaseRef(repo);
		expect(base).toBe("main");
		expect(ref).toBe("main");
	});

	test("returns null ref when nothing resolvable", async () => {
		const bare = mkdtempSync(join(tmpdir(), "cc-nobase-"));
		await $`git -C ${bare} init -q`;
		await $`git -C ${bare} config user.email t@t.co`;
		await $`git -C ${bare} config user.name test`;
		writeFileSync(join(bare, "x.txt"), "x\n");
		await $`git -C ${bare} add x.txt`;
		await $`git -C ${bare} commit -qm init`;
		await $`git -C ${bare} branch -m feature-only`;
		const { ref } = await resolveBaseRef(bare);
		expect(ref).toBeNull();
		rmSync(bare, { recursive: true, force: true });
	});
});

describe("getDiffFiles base mode", () => {
	test("base mode includes committed AND uncommitted changes since the base", async () => {
		await $`git -C ${repo} branch -M main`;
		await $`git -C ${repo} checkout -qb feature`;
		// Distinct, non-overlapping markers (toContain is substring match).
		writeFileSync(join(repo, "a.txt"), "ALPHA_on_branch\n");
		await $`git -C ${repo} add a.txt`;
		await $`git -C ${repo} commit -qm feat`;
		writeFileSync(join(repo, "b.txt"), "BETA_working\n");
		await $`git -C ${repo} add b.txt`;

		const working = await getDiffFiles(repo, { mode: "working" });
		const workingA = working.find((f) => f.name === "a.txt");
		expect(workingA).toBeUndefined();

		const base = await getDiffFiles(repo, { mode: "base", ref: "main" });
		const baseA = base.find((f) => f.name === "a.txt");
		const baseB = base.find((f) => f.name === "b.txt");
		expect(baseA?.newContents).toContain("ALPHA_on_branch");
		expect(baseB?.newContents).toContain("BETA_working");
	});
});
