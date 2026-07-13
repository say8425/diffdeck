// In-app find (Cmd/Ctrl+F): opens `#find-bar`, highlights every match across
// files (`mark.cc-find-hit` in each `<diffs-container>`'s shadow root, plus
// `mark.cc-find-hit--active` on the current one), and Enter advances to the
// next match. `src/hello.ts`'s working-tree diff contains "hello" twice per
// line (the `hello` identifier and the `"hello, world"` string literal) on
// both its deletion and addition lines, so a "hello" query reliably yields
// multiple matches within a single small fixture file (confirmed empirically:
// 4 total, "1/4" on open).
import { expect, test } from "./fixtures/app.ts";

test("Cmd/Ctrl+F opens find, highlights matches, and Enter advances", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const findBar = page.locator("#find-bar");
	await expect(findBar).toBeHidden();

	// findBar.ts's shortcut listener accepts either modifier
	// (`event.metaKey || event.ctrlKey`), so Control+F opens it regardless of
	// the host OS the test runner is on.
	await page.keyboard.press("Control+F");
	await expect(findBar).toBeVisible();

	await page.locator("#find-input").fill("hello");

	const findCount = page.locator("#find-count");
	await expect(findCount).toHaveText(/\d+\/\d+/);

	const hitCount = () =>
		page.evaluate(
			() =>
				Array.from(document.querySelectorAll("diffs-container")).flatMap((c) =>
					Array.from(c.shadowRoot?.querySelectorAll("mark.cc-find-hit") ?? []),
				).length,
		);
	await expect.poll(hitCount).toBeGreaterThan(0);

	const activeCount = () =>
		page.evaluate(
			() =>
				Array.from(document.querySelectorAll("diffs-container")).flatMap((c) =>
					Array.from(
						c.shadowRoot?.querySelectorAll("mark.cc-find-hit--active") ?? [],
					),
				).length,
		);
	await expect.poll(activeCount).toBe(1);

	const countBefore = await findCount.textContent();
	const numeratorBefore = Number(countBefore?.split("/")[0]);

	await page.locator("#find-input").press("Enter");

	// Web-first: poll until the numerator actually advances (wraps mod total),
	// rather than a fixed sleep.
	await expect
		.poll(async () => {
			const text = await findCount.textContent();
			return Number(text?.split("/")[0]);
		})
		.not.toBe(numeratorBefore);
	await expect.poll(activeCount).toBe(1);
});
