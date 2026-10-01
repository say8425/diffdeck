// renderPatch가 items를 만들기 전에 syncTreeFold를 불러야 한다(viewer.md
// "갱신과 캐시").
import { expect, hasCode, launchViewer, test as base } from "./fixtures/app.ts";

const test = base.extend<{ foldUrl: string }>({
	foldUrl: async ({}, use) => {
		const { url, stop } = await launchViewer(["--fold-with-tree"]);
		await use(url);
		await stop();
	},
});

test("switching Unified/Split keeps tree-driven folds correct after the items are rebuilt", async ({
	page,
	foldUrl,
}) => {
	await page.goto(foldUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);

	await page
		.locator("file-tree-container")
		.locator('[data-item-path="src/"]')
		.click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);

	await page.locator('#diff-style-group [data-style="split"]').click();
	await expect(
		page.locator('#diff-style-group [data-style="split"]'),
	).toHaveAttribute("aria-pressed", "true");

	expect(await hasCode(page, "src/hello.ts")).toBe(false);
});
