// Tree and diff content live in open shadow roots that the hosts' textContent
// doesn't cross, so these checks read `el.shadowRoot` directly.
import { expect, test } from "./fixtures/app.ts";

test("renders the fixture repo diff", async ({ page, viewerUrl }) => {
	await page.goto(viewerUrl);

	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const diffContainers = page.locator("diffs-container");
	await expect(diffContainers.first()).toBeVisible();
	expect(await diffContainers.count()).toBeGreaterThan(0);

	// Match on `data-item-path`: the extension-aware middle-truncation splits a
	// name across DOM nodes, so it never appears as one text run.
	const treeHasPath = (path: string): Promise<boolean> =>
		page
			.locator("file-tree-container")
			.evaluate(
				(el, p) =>
					el.shadowRoot?.querySelector(`[data-item-path="${p}"]`) != null,
				path,
			);

	await expect.poll(() => treeHasPath("README.md")).toBe(true);
	expect(await treeHasPath("src/hello.ts")).toBe(true);

	// Tokens carry `--diffs-token-*` custom properties rather than `color:`.
	// Check every container: the first may be the image's empty diff item.
	const hasHighlightedToken = (): Promise<boolean> =>
		page.evaluate(() =>
			Array.from(document.querySelectorAll("diffs-container")).some(
				(el) =>
					el.shadowRoot?.querySelector('span[style*="--diffs-token"]') != null,
			),
		);

	await expect.poll(hasHighlightedToken, { timeout: 15_000 }).toBe(true);
});
