// Fold-with-tree + --watch: 폴더를 접은 채로 watch 폴링이 그 디렉토리 아래에
// 새 파일을 추가하면 자동으로 접히고, 기존에 접혀 있던 파일은 폴링 사이클을
// 거쳐도 계속 접힌 채 유지되는지 검증한다. `fileTree.resetPaths()`가(이 기능과
// 무관하게 이미) 매번 모든 디렉토리를 펼침으로 되돌리는 것을
// captureCollapsedDirPaths/reapplyCollapsedDirs가 보정하는지에 대한 회귀
// 가드다.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launchViewer, test as base } from "./fixtures/app.ts";

const test = base.extend<{ watchViewer: { url: string; repoDir: string } }>({
	watchViewer: async ({}, use) => {
		const { url, repoDir, stop } = await launchViewer([
			"--watch",
			"--fold-with-tree",
			"--untracked",
		]);
		await use({ url, repoDir });
		await stop();
	},
});

const hasCode = (page: Page, fileId: string): Promise<boolean> =>
	page
		.locator("diffs-container")
		.filter({ has: page.locator(`[data-fold="${fileId}"]`) })
		.evaluate((el) => el.shadowRoot?.querySelector("pre") != null);

test("a directory collapsed via the tree stays collapsed across a watch poll, and a new file added under it while collapsed is auto-folded", async ({
	page,
	watchViewer,
}) => {
	await page.goto(watchViewer.url);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);

	await page
		.locator("file-tree-container")
		.locator('[data-item-path="src/"]')
		.click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);

	writeFileSync(
		join(watchViewer.repoDir, "src", "new-file.ts"),
		"export const x = 1;\n",
	);

	await expect(page.locator('[data-fold="src/new-file.ts"]')).toHaveCount(1, {
		timeout: 15_000,
	});
	expect(await hasCode(page, "src/new-file.ts")).toBe(false);
	// The pre-existing collapsed file is unaffected by the poll-triggered
	// re-render (this is the resetPaths-preservation regression guard).
	expect(await hasCode(page, "src/hello.ts")).toBe(false);
});
