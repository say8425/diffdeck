// find bar가 트리 때문에 접힌 파일의 검색 결과를 임시로 펼쳤을 때, 검색이
// 열려 있는 동안 사이드바 트리를 조작해(그 파일의 디렉토리를 펼침) 실제
// 접힘 근거가 사라지면, 검색을 닫아도 잘못 재접히지 않고 펼쳐진 채로 남아야
// 한다 — restoreAutoExpanded가 무조건 collapsed:true가 아니라
// effectiveCollapsed를 재평가하도록 고친 것에 대한 회귀 가드.
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
	await srcRow.click(); // collapse `src` — hello.ts tree-folds
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);

	await page.keyboard.press("Control+F");
	await page.locator("#find-input").fill("hello");
	// The match forces hello.ts open despite `src` staying collapsed; this
	// also adds it to the find bar's temporary `autoExpandedIds` bookkeeping.
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);

	// Manually collapse it via its own header while the search is still open.
	await page.locator('[data-fold="src/hello.ts"]').click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);
	// ...then manually re-expand it. This is a fresh manual override — `src`
	// is still collapsed in the tree, so without the fix this file would
	// still be flagged in the find bar's `autoExpandedIds`.
	await page.locator('[data-fold="src/hello.ts"]').click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);

	await page.locator("#find-close").click();
	await expect(page.locator("#find-bar")).toBeHidden();

	// The manual re-expand must survive search closing — restoreAutoExpanded
	// must not re-collapse a file the user has since claimed with a direct
	// click, even though the file passed through the find bar's temporary
	// expand earlier in this same session.
	expect(await hasCode(page, "src/hello.ts")).toBe(true);
});
