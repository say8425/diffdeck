// The file header is `position: sticky` (CodeView's `stickyHeaders: true`), so
// a file's own code scrolls underneath its header. Any hover styling must
// therefore keep the header background fully opaque: `background-color`
// replaces the engine's opaque `var(--diffs-bg)` rather than compositing over
// it, so a translucent hover colour (a bare `rgba(255,255,255,.05)`) lets the
// code show through the pinned header — and, because headers sweep under a
// stationary cursor while scrolling, makes them blink on every pass.
import { expect, test } from "./fixtures/app.ts";

// Computed background-color arrives as `rgb()`/`rgba()`, or as
// `color(srgb r g b [/ a])` for a color-mix() result. Only an explicit alpha
// component can make it translucent.
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

	// `transition: background-color .15s` means the computed value is animated:
	// sample until it stops changing so we assert the settled colour, not an
	// in-flight one (which still reads opaque on the very first frame).
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
	// The copy button is opacity-toggled by the same `:hover`, so its
	// appearance proves the hover actually landed on the header.
	await expect(container.locator("[data-copy-name]")).toBeVisible();

	expect(alphaOf(await settledBackground())).toBe(1);
});
