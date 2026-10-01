import { expect, test } from "./fixtures/app.ts";

test("a changed binary image renders inline Old/New cards", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// Select it in the tree so CodeView scrolls it into the virtualized render
	// range instead of relying on the initial paint.
	const treeRow = page
		.locator("file-tree-container")
		.locator('[data-item-path="assets/logo.png"]');
	await expect(treeRow).toBeVisible();
	await treeRow.click();

	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="assets/logo.png"]') });
	await expect(container).toBeVisible();

	const card = container.locator("[data-image-card]");
	await expect(card).toBeVisible();

	// logo.png is modified (neither added nor deleted), so both panes render.
	const oldImg = card.locator(".img-pane--old img");
	const newImg = card.locator(".img-pane--new img");

	await expect(oldImg).toHaveAttribute("src", /\/api\/blob/);
	await expect(newImg).toHaveAttribute("src", /\/api\/blob/);
});
