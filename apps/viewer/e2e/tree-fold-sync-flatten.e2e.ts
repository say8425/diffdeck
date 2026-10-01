import { expect, hasCode, launchViewer, test as base } from "./fixtures/app.ts";

const test = base.extend<{ nestedUrl: string }>({
	nestedUrl: async ({}, use) => {
		const { url, stop } = await launchViewer(["--fold-with-tree"], {
			nestedChainFile: true,
		});
		await use(url);
		await stop();
	},
});

test("collapsing a flatten-compressed directory row folds its diff file", async ({
	page,
	nestedUrl,
}) => {
	await page.goto(nestedUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect.poll(() => hasCode(page, "src/mid/deep/nested.ts")).toBe(true);

	// The flattened row maps only to the chain's terminal path (trailing slash),
	// and clicking it toggles just that path.
	const chainRow = page
		.locator("file-tree-container")
		.locator('[data-item-path="src/mid/deep/"]');
	await expect(chainRow).toBeVisible();
	await chainRow.click();

	await expect.poll(() => hasCode(page, "src/mid/deep/nested.ts")).toBe(false);
	await expect(
		page.locator('[data-fold="src/mid/deep/nested.ts"]'),
	).toHaveAttribute("aria-label", "Expand file");
});
