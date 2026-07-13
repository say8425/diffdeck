// Hovering a file header reveals a "copy file path" button
// (`[data-copy-name]`, opacity-toggled on `[data-diffs-header]:hover` via
// unsafeCSS in main.ts); clicking it writes the file's exact path to the
// clipboard (copyButton.ts's `createCopyButton`), with `stopPropagation` so
// it never also triggers the header's fold toggle.
import { expect, test } from "./fixtures/app.ts";

test("copy button on header hover copies the file path", async ({
	page,
	viewerUrl,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="src/hello.ts"]') });
	await expect(container).toBeVisible();

	const header = container.locator("[data-diffs-header]").first();
	const copyButton = container.locator("[data-copy-name]");

	await header.hover();
	await expect(copyButton).toBeVisible();
	await copyButton.click();

	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe("src/hello.ts");

	// The click must not have also toggled the fold (stopPropagation).
	const hasCode = () =>
		container.evaluate((el) => el.shadowRoot?.querySelector("pre") != null);
	await expect.poll(hasCode).toBe(true);
});
