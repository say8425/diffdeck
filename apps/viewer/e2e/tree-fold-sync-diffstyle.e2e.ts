// Fold-with-tree + Unified/Split 토글: CodeView가 재생성돼도 트리 유래 접힘이
// 그대로 반영되는지 검증한다 — renderPatch()가 트리 동기화(syncTreeFold) 이후에
// 아이템 배열을 만들도록 순서를 바꾼 것에 대한 회귀 가드.
import { expect, hasCode, launchViewer, test as base } from "./fixtures/app.ts";

const test = base.extend<{ foldUrl: string }>({
	foldUrl: async ({}, use) => {
		const { url, stop } = await launchViewer(["--fold-with-tree"]);
		await use(url);
		await stop();
	},
});

test("switching Unified/Split keeps tree-driven folds correct after CodeView is recreated", async ({
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

	// CodeView was recreated for the style change; the tree-driven fold must
	// still be reflected in the freshly-built items.
	expect(await hasCode(page, "src/hello.ts")).toBe(false);
});
