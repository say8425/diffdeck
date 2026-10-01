// 검색을 닫을 때 restoreAutoExpanded는 무조건 다시 접지 않고 effectiveCollapsed를
// 다시 판정해야 한다.
import { expect, hasCode, launchViewer, test as base } from "./fixtures/app.ts";

const test = base.extend<{ foldUrl: string }>({
	foldUrl: async ({}, use) => {
		const { url, stop } = await launchViewer(["--fold-with-tree"]);
		await use(url);
		await stop();
	},
});

test("a search-expanded file stays expanded if its directory is expanded in the tree before the search closes", async ({
	page,
	foldUrl,
}) => {
	await page.goto(foldUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);

	const srcRow = page
		.locator("file-tree-container")
		.locator('[data-item-path="src/"]');
	await srcRow.click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);

	await page.keyboard.press("Control+F");
	await page.locator("#find-input").fill("hello");
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);

	await srcRow.click();

	await page.locator("#find-close").click();
	await expect(page.locator("#find-bar")).toBeHidden();

	expect(await hasCode(page, "src/hello.ts")).toBe(true);
});

test("manually clicking a search-expanded file's header claims it away from the find bar, surviving search close", async ({
	page,
	foldUrl,
}) => {
	await page.goto(foldUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);

	const srcRow = page
		.locator("file-tree-container")
		.locator('[data-item-path="src/"]');
	await srcRow.click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);

	await page.keyboard.press("Control+F");
	await page.locator("#find-input").fill("hello");
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);

	// Collapsing then re-expanding by hand claims the file from the find bar's
	// `autoExpandedIds`; with `src` still collapsed, a stale entry would re-fold
	// it when the search closes.
	await page.locator('[data-fold="src/hello.ts"]').click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);
	await page.locator('[data-fold="src/hello.ts"]').click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);

	await page.locator("#find-close").click();
	await expect(page.locator("#find-bar")).toBeHidden();

	expect(await hasCode(page, "src/hello.ts")).toBe(true);
});
