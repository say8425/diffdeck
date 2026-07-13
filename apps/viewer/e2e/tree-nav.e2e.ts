// Regression guard for the FileTreeVanillaView `#pointerInteracting` fix: a
// SINGLE click on a file-tree row must scroll the diff to that file. Before
// the fix, a pointer-driven `focusin` fired mid-click (between mousedown and
// mouseup) rebuilt every row synchronously and detached the pressed
// `<button>` before the browser could deliver `click` -- the row silently
// required a double-click to select. This spec clicks exactly once and
// asserts the scroll happened, and -- to prove the click caused it, not
// page-load layout -- first forces the target out of view and confirms it's
// actually out.
//
// Tree rows live in `<file-tree-container>`'s open shadow root and are
// matched on `data-item-path` (see render.e2e.ts's header comment for why:
// Pierre's extension-aware middle-truncation splits long filenames across
// DOM nodes, so literal text never appears contiguously). `<diffs-container>`
// is a light-DOM custom element (its fold button is slotted content, not
// inside its shadow root -- see main.ts's `containerFileId`), so it's matched
// on its child `[data-fold="<path>"]`.
//
// The viewport is shrunk so the three-file fixture repo's diff pane
// (`#diff`, `overflow:auto`) actually overflows -- at the default 1280x720
// viewport all three files fit without scrolling, which would make this
// regression guard vacuous (empirically confirmed while writing this spec).
import { expect, test } from "./fixtures/app.ts";

test("a single click on a tree row scrolls the diff to that file", async ({
	page,
	viewerUrl,
}) => {
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

	// Force the target out of view by scrolling the diff pane to its max
	// (the browser clamps an oversized scrollTop), then confirm it's actually
	// scrolled away -- proving the click below (not initial layout) causes
	// the scroll back into view.
	await diffScroll.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	await expect(targetContainer).not.toBeInViewport();
	const scrollTopBefore = await diffScroll.evaluate((el) => el.scrollTop);

	// Exactly ONE click -- never double-click; this is the behaviour under
	// regression guard.
	await treeRow.click();

	// The click's selection change scrolls asynchronously
	// (FileTree's onSelectionChange -> codeView.scrollTo), so use web-first
	// (auto-retrying) assertions rather than a fixed wait.
	await expect(targetContainer).toBeInViewport();
	await expect
		.poll(() => diffScroll.evaluate((el) => el.scrollTop))
		.not.toBe(scrollTopBefore);
});
