import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { prewarmDiff } from "../server/prewarm.ts";
import { startDiffServer } from "../server/server.ts";

let repo: string;
let viewerDir: string;
let cacheHome: string;
let handle: ReturnType<typeof startDiffServer>;

beforeEach(async () => {
	repo = mkdtempSync(join(tmpdir(), "cc-warm-repo-"));
	await $`git -C ${repo} init -q`;
	await $`git -C ${repo} config user.email t@t.co`;
	await $`git -C ${repo} config user.name test`;
	writeFileSync(join(repo, "a.txt"), "one\n");
	await $`git -C ${repo} add a.txt`;
	await $`git -C ${repo} commit -qm init`;
	writeFileSync(join(repo, "a.txt"), "two\n");
	viewerDir = mkdtempSync(join(tmpdir(), "cc-warm-view-"));
	writeFileSync(join(viewerDir, "index.html"), "<html></html>");
	cacheHome = mkdtempSync(join(tmpdir(), "cc-warm-cache-"));
	handle = startDiffServer({
		port: 0,
		viewerDir,
		env: { XDG_CACHE_HOME: cacheHome },
	});
});

afterEach(() => {
	handle.stop();
	for (const d of [repo, viewerDir, cacheHome])
		rmSync(d, { recursive: true, force: true });
});

describe("prewarmDiff", () => {
	test("warms both working and base modes against a live server", async () => {
		const warmed = await prewarmDiff({
			port: handle.server.port ?? 0,
			repo,
			token: handle.token,
			untracked: false,
		});
		expect(warmed).toBe(2);
	});

	test("a wrong token warms nothing (params really reach the server)", async () => {
		const warmed = await prewarmDiff({
			port: handle.server.port ?? 0,
			repo,
			token: "wrong",
			untracked: false,
		});
		expect(warmed).toBe(0);
	});

	test("an unreachable server is swallowed, not thrown", async () => {
		const warmed = await prewarmDiff({
			// 방금 잡았다 놓은 포트가 아닌, 예약된 미사용 포트 0 → 연결 실패 확정.
			port: 1,
			repo,
			token: "t",
			untracked: false,
		});
		expect(warmed).toBe(0);
	});
});
