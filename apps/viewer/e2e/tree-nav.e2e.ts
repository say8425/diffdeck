import { expect, test } from "./fixtures/app.ts";

test("a single click on a tree row scrolls the diff to that file", async ({
	page,
	viewerUrl,
}) => {
	// At the default viewport every fixture file fits, so nothing would scroll.
	await page.setViewportSize({ width: 1024, height: 200 });
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const diffScroll = page.locator("#diff");
	const treeRow = page
		.locator("file-tree-container")
		.locator('[data-item-path="src/hello.ts"]');
	await expect(treeRow).toBeVisible();

	const targetContainer = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="src/hello.ts"]') });
	await expect(targetContainer).toHaveCount(1);

	// Scroll the target away first so the click, not the initial layout, is
	// what brings it back into view.
	await diffScroll.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	await expect(targetContainer).not.toBeInViewport();
	const scrollTopBefore = await diffScroll.evaluate((el) => el.scrollTop);

	// Exactly one click: a row rebuild between mousedown and mouseup would
	// swallow it (FileTreeVanillaView's `#pointerInteracting` guard).
	await treeRow.click();

	await expect(targetContainer).toBeInViewport();
	await expect
		.poll(() => diffScroll.evaluate((el) => el.scrollTop))
		.not.toBe(scrollTopBefore);
});
