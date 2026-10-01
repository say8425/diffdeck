// Headers are sticky and code scrolls beneath them, so a translucent hover
// background lets the code show through (and blink while scrolling).
import { expect, test } from "./fixtures/app.ts";

// Computed colors come as rgb()/rgba(), or as `color(srgb r g b / a)` from
// color-mix().
const alphaOf = (color: string): number => {
	const rgba = color.match(/^rgba\(.*,\s*([\d.]+)\s*\)$/);
	if (rgba?.[1] != null) return Number(rgba[1]);
	const slash = color.match(/\/\s*([\d.]+)\s*\)$/);
	if (slash?.[1] != null) return Number(slash[1]);
	return 1;
};

test("file header background stays opaque while hovered", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="src/hello.ts"]') });
	const header = container.locator("[data-diffs-header]").first();
	await expect(header).toBeVisible();

	const backgroundOf = (): Promise<string> =>
		header.evaluate((el) => getComputedStyle(el).backgroundColor);

	// The background transitions, and its first frame still reads opaque —
	// sample until it settles.
	const settledBackground = async (): Promise<string> => {
		let previous = await backgroundOf();
		for (let i = 0; i < 20; i++) {
			await page.waitForTimeout(50);
			const next = await backgroundOf();
			if (next === previous) return next;
			previous = next;
		}
		return previous;
	};

	expect(alphaOf(await settledBackground())).toBe(1);

	await header.hover();
	// The copy button shows on the same `:hover`, proving the hover landed.
	await expect(container.locator("[data-copy-name]")).toBeVisible();

	expect(alphaOf(await settledBackground())).toBe(1);
});
