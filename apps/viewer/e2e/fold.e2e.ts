// Clicking a file's header bar toggles it collapsed/expanded (main.ts's
// delegated `diffMount` click handler, gated on `[data-diffs-header]` via
// `composedPath`). Collapsing removes the rendered `<pre>` from the file's
// shadow DOM entirely (`@diffdeck/diffs`' `FileDiff#render`: `collapsed`
// short-circuits to `removeRenderedCode()`), and the fold button's chevron
// SVG (main.ts's `makeFoldButton`) rotates from 0deg to -90deg -- both
// confirmed empirically against the live viewer while writing this spec.
import { expect, test } from "./fixtures/app.ts";

test("clicking a file header collapses and re-expands it", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="src/hello.ts"]') });
	await expect(container).toBeVisible();

	const header = container.locator("[data-diffs-header]").first();
	const foldButton = container.locator('[data-fold="src/hello.ts"]');
	const hasCode = () =>
		container.evaluate((el) => el.shadowRoot?.querySelector("pre") != null);

	// Expanded on first render.
	await expect.poll(hasCode).toBe(true);
	await expect(foldButton).toHaveAttribute("aria-label", "Collapse file");

	await header.click();

	await expect.poll(hasCode).toBe(false);
	await expect(foldButton).toHaveAttribute("aria-label", "Expand file");
	await expect
		.poll(() =>
			foldButton.evaluate((b) => b.querySelector("svg")?.style.transform),
		)
		.toBe("rotate(-90deg)");

	await header.click();

	await expect.poll(hasCode).toBe(true);
	await expect(foldButton).toHaveAttribute("aria-label", "Collapse file");
	await expect
		.poll(() =>
			foldButton.evaluate((b) => b.querySelector("svg")?.style.transform),
		)
		.toBe("rotate(0deg)");
});
