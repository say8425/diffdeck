// Smoke spec: launch the built viewer against the fixture repo and assert the
// real browser-rendered result — status line, tree, at least one rendered
// diff, and a syntax-highlighted token. Web-first (auto-retrying) assertions
// only; no fixed sleeps.
//
// The tree and diff content both live inside *open* shadow roots
// (`<file-tree-container>`, `<diffs-container>`). The host elements'
// `textContent`/`innerText` do NOT reliably cross that boundary (shadow DOM
// encapsulation), so checks here reach into `el.shadowRoot` directly via
// `page.evaluate`/`locator.evaluate` rather than relying on locator-level
// text matching across the boundary.
import { expect, test } from "./fixtures/app.ts";

test("renders the fixture repo diff", async ({ page, viewerUrl }) => {
	await page.goto(viewerUrl);

	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// At least one <diffs-container> (open shadow root) is mounted.
	const diffContainers = page.locator("diffs-container");
	await expect(diffContainers.first()).toBeVisible();
	expect(await diffContainers.count()).toBeGreaterThan(0);

	// The file tree lists the two text-diff fixture files. Row buttons carry
	// the exact, untruncated path as `data-item-path` (@diffdeck/trees'
	// `computeFileTreeRowElementAttributes`) — match on that attribute rather
	// than rendered text, since long filenames get visually split by Pierre's
	// extension-aware middle-truncation (e.g. "README.md" renders as
	// "README." + "…" + "md" across separate DOM nodes, so it never appears as
	// one contiguous text substring).
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

	// A syntax-highlighted token: @diffdeck/diffs' Shiki pipeline emits
	// `<span style="--diffs-token-dark:#...;--diffs-token-light:#...">` per
	// token (theme-switchable CSS custom properties, not a literal `color:`
	// declaration). Check every diffs-container's shadow root — file order
	// isn't guaranteed to put a text diff (vs. the binary image's empty diff
	// item) first.
	const hasHighlightedToken = (): Promise<boolean> =>
		page.evaluate(() =>
			Array.from(document.querySelectorAll("diffs-container")).some(
				(el) =>
					el.shadowRoot?.querySelector('span[style*="--diffs-token"]') != null,
			),
		);

	await expect.poll(hasHighlightedToken, { timeout: 15_000 }).toBe(true);
});
