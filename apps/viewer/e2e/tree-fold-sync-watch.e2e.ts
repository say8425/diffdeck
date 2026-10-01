// 갱신의 `fileTree.resetPaths()`는 모든 디렉토리를 다시 펼친다 — 직전 접힘을
// 되살리는지 본다(viewer.md "갱신과 캐시").
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, hasCode, launchViewer, test as base } from "./fixtures/app.ts";

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
	expect(await hasCode(page, "src/hello.ts")).toBe(false);
});
