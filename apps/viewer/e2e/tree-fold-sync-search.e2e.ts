// find bar가 트리 때문에 접힌 파일의 검색 결과를 임시로 펼쳤을 때, 검색이
// 열려 있는 동안 사이드바 트리를 조작해(그 파일의 디렉토리를 펼침) 실제
// 접힘 근거가 사라지면, 검색을 닫아도 잘못 재접히지 않고 펼쳐진 채로 남아야
// 한다 — restoreAutoExpanded가 무조건 collapsed:true가 아니라
// effectiveCollapsed를 재평가하도록 고친 것에 대한 회귀 가드.
import type { Page } from "@playwright/test";
import { expect, launchViewer, test as base } from "./fixtures/app.ts";

const test = base.extend<{ foldUrl: string }>({
	foldUrl: async ({}, use) => {
		const { url, stop } = await launchViewer(["--fold-with-tree"]);
		await use(url);
		await stop();
	},
});

const hasCode = (page: Page, fileId: string): Promise<boolean> =>
	page
		.locator("diffs-container")
		.filter({ has: page.locator(`[data-fold="${fileId}"]`) })
		.evaluate((el) => el.shadowRoot?.querySelector("pre") != null);

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
	await srcRow.click(); // collapse
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);

	await page.keyboard.press("Control+F");
	await page.locator("#find-input").fill("hello");
	// The first match lands in src/hello.ts, forcing it open despite `src`
	// still being collapsed in the tree.
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);

	// Expand `src` again while the find bar is still open.
	await srcRow.click();

	await page.locator("#find-close").click();
	await expect(page.locator("#find-bar")).toBeHidden();

	// src/hello.ts must remain expanded: its directory is expanded again, and
	// it was never manually collapsed.
	expect(await hasCode(page, "src/hello.ts")).toBe(true);
});
