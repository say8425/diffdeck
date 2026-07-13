// Inline image diff cards: a changed binary image (`assets/logo.png`,
// committed red then overwritten blue in the fixture repo -- see repo.ts) is
// binary but still gets an empty diff item in the CodeView flow (header +
// fold button, no code body), and imageCard.ts's `ensureImageCard` (called
// from main.ts's `onPostRender`) injects an Old/New card into that item's
// `<diffs-container>` shadow DOM. Playwright's CSS-selector locators
// auto-pierce open shadow roots (confirmed empirically in fold.e2e.ts /
// copy-path.e2e.ts via the same `[data-fold]`/`[data-diffs-header]`
// pattern), so the card and its panes are reachable via ordinary
// `locator.locator(...)` chaining -- no manual `shadowRoot` reach-in needed
// here.
//
// logo.png's fixture status is "modified" (committed, then overwritten --
// neither added/untracked nor deleted), so `imageEntries()` sets both
// `showOld` and `showNew`: both `.img-pane--old` and `.img-pane--new` render.
import { expect, test } from "./fixtures/app.ts";

test("a changed binary image renders inline Old/New cards", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// Select the image file in the tree so CodeView scrolls its item into the
	// virtualized render range (same selection flow as tree-nav.e2e.ts), rather
	// than relying on it already being within the initial paint.
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

	const oldImg = card.locator(".img-pane--old img");
	const newImg = card.locator(".img-pane--new img");

	await expect(oldImg).toHaveAttribute("src", /\/api\/blob/);
	await expect(newImg).toHaveAttribute("src", /\/api\/blob/);
});
