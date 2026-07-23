// Drag/keyboard resize of the file-tree sidebar. #tree-resizer sits between
// #tree and #diff as its own grid track (browser/main.ts wires pointer +
// keyboard events; browser/resize.ts holds the pure width math, both unit
// tested). The live width lives in the `--vd-tree-w` CSS custom property on
// #app, set directly via `style.setProperty` (not through a `var()` fallback
// chain), so reading it back with getComputedStyle is an exact,
// layout-independent way to assert a resize took effect -- no boundingBox
// subpixel rounding to fight.
import type { Page } from "@playwright/test";
import { expect, launchViewer, test as base } from "./fixtures/app.ts";

const TREE_WIDTH_KEY = "cc-statusline:tree-width";

const test = base.extend<{ treeRightUrl: string }>({
	treeRightUrl: async ({}, use) => {
		const { url, stop } = await launchViewer(["--tree-right"]);
		await use(url);
		await stop();
	},
});

const readTreeWidth = (page: Page): Promise<number> =>
	page
		.locator("#app")
		.evaluate((el) =>
			parseFloat(getComputedStyle(el).getPropertyValue("--vd-tree-w")),
		);

const dragResizer = async (page: Page, deltaX: number): Promise<void> => {
	const box = await page.locator("#tree-resizer").boundingBox();
	if (!box) throw new Error("#tree-resizer has no bounding box");
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + deltaX, y, { steps: 8 });
	await page.mouse.up();
};

test("dragging the resizer changes the tree width", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const startWidth = await readTreeWidth(page);
	await dragResizer(page, 80);

	await expect.poll(() => readTreeWidth(page)).toBe(startWidth + 80);
});

test("the resized width persists across reload", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const startWidth = await readTreeWidth(page);
	await dragResizer(page, -60);
	const expected = startWidth - 60;
	await expect.poll(() => readTreeWidth(page)).toBe(expected);

	const stored = await page.evaluate(
		(key) => localStorage.getItem(key),
		TREE_WIDTH_KEY,
	);
	expect(stored).toBe(String(expected));

	await page.reload();
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect.poll(() => readTreeWidth(page)).toBe(expected);
});

test("dragging with the tree on the right mirrors the direction", async ({
	page,
	treeRightUrl,
}) => {
	await page.goto(treeRightUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect(page.locator("#app")).toHaveAttribute("data-tree-side", "right");

	const startWidth = await readTreeWidth(page);
	// Dragging the resizer LEFT (negative delta) grows a right-side tree.
	await dragResizer(page, -70);

	await expect.poll(() => readTreeWidth(page)).toBe(startWidth + 70);
});

test("arrow keys adjust the width in 10px steps and persist", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const startWidth = await readTreeWidth(page);
	await page.locator("#tree-resizer").focus();
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowRight");

	await expect.poll(() => readTreeWidth(page)).toBe(startWidth + 20);
	const stored = await page.evaluate(
		(key) => localStorage.getItem(key),
		TREE_WIDTH_KEY,
	);
	expect(stored).toBe(String(startWidth + 20));
});

test("dragging past the bounds clamps to 180-600", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	await dragResizer(page, -1000);
	await expect.poll(() => readTreeWidth(page)).toBe(180);

	await dragResizer(page, 1000);
	await expect.poll(() => readTreeWidth(page)).toBe(600);
});
