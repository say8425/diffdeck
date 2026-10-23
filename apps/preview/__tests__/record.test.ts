import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { recordSnapshot } from "../record.ts";

// git이 바이너리로 보도록 NUL을 넣는다.
const png = (n: number) => Buffer.from([0x89, 0x50, 0x00, n]);

describe("recordSnapshot", () => {
	let root: string;
	let repo: string;
	let viewerDir: string;
	let outDir: string;

	beforeEach(async () => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "dd-record-")));
		repo = join(root, "repo");
		viewerDir = join(root, "viewer");
		outDir = join(root, "site");
		mkdirSync(viewerDir);
		writeFileSync(join(viewerDir, "index.html"), "<html>");
		await $`git init -q ${repo}`;
		await $`git -C ${repo} config user.email t@t.co`;
		await $`git -C ${repo} config user.name test`;
		writeFileSync(join(repo, "a.txt"), "one\n");
		writeFileSync(join(repo, "logo.png"), png(1));
		await $`git -C ${repo} add -A`;
		await $`git -C ${repo} commit -q -m init`;
		// git init은 머신의 init.defaultBranch를 따르므로 이름을 고정한다.
		await $`git -C ${repo} branch -M main`;
		await $`git -C ${repo} checkout -q -b feat`;
		writeFileSync(join(repo, "a.txt"), "two\n");
		writeFileSync(join(repo, "logo.png"), png(2));
		writeFileSync(join(repo, "new.png"), png(3));
		await $`git -C ${repo} add -A`;
		await $`git -C ${repo} commit -q -m change`;
	});

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	const record = (base: string) =>
		recordSnapshot({
			repo,
			viewerDir,
			outDir,
			base,
			listPrs: () => Promise.resolve({}),
		});

	test("records the first-screen API calls against the real server", async () => {
		const manifest = await record("main");
		expect(manifest.repo).toBe(repo);
		expect(manifest.base).toBe("main");
		expect(Object.keys(manifest.entries).toSorted()).toEqual([
			"/api/blob:new:logo.png",
			"/api/blob:new:new.png",
			"/api/blob:old:logo.png",
			"/api/diff",
			"/api/ping",
			"/api/prs",
			"/api/refs",
			"/api/summary",
		]);
		expect(manifest.entries["/api/ping"]).toMatchObject({
			status: 204,
			file: null,
		});
		const diff = manifest.entries["/api/diff"];
		expect(diff.status).toBe(200);
		expect(diff.headers["x-diff-base"]).toBe("main");
		expect(diff.headers.etag).toBeTruthy();
		const files = JSON.parse(
			readFileSync(join(outDir, "_snapshot", diff.file ?? ""), "utf8"),
		) as { name: string }[];
		expect(files.map((f) => f.name).toSorted()).toEqual([
			"a.txt",
			"logo.png",
			"new.png",
		]);
		const oldLogo = manifest.entries["/api/blob:old:logo.png"];
		expect(oldLogo.headers["content-type"]).toBe("image/png");
		expect(readFileSync(join(outDir, "_snapshot", oldLogo.file ?? ""))).toEqual(
			png(1),
		);
	});

	test("lays the snapshot over a copy of the built viewer", async () => {
		mkdirSync(outDir);
		writeFileSync(join(outDir, "stale.txt"), "x");
		const manifest = await record("main");
		expect(readFileSync(join(outDir, "index.html"), "utf8")).toBe("<html>");
		expect(existsSync(join(outDir, "stale.txt"))).toBe(false);
		const onDisk = JSON.parse(
			readFileSync(join(outDir, "_snapshot", "manifest.json"), "utf8"),
		) as unknown;
		expect(onDisk).toEqual(manifest);
	});

	test("records a failed diff as is and fetches no blobs", async () => {
		const manifest = await record("no-such-branch");
		const diff = manifest.entries["/api/diff"];
		expect(diff.status).toBe(400);
		expect(diff.headers["x-diff-error"]).toBe("unknown-base");
		expect(
			Object.keys(manifest.entries).some((k) => k.startsWith("/api/blob")),
		).toBe(false);
	});
});
