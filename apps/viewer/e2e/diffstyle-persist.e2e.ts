import {
	expect,
	launchViewer,
	renderedDiffType,
	test,
} from "./fixtures/app.ts";

const DIFF_STYLE_KEY = "diffdeck:diff-style";

test("the picked Unified/Split layout survives a reload", async ({ page }) => {
	const viewer = await launchViewer([]);
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		const split = page.locator('#diff-style-group [data-style="split"]');
		const unified = page.locator('#diff-style-group [data-style="unified"]');
		await expect(unified).toHaveAttribute("aria-pressed", "true");

		await split.click();
		expect(
			await page.evaluate((k) => localStorage.getItem(k), DIFF_STYLE_KEY),
		).toBe("split");

		await page.reload();
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		await expect(split).toHaveAttribute("aria-pressed", "true");
		await expect.poll(() => renderedDiffType(page)).toBe("split");

		await unified.click();
		await page.reload();
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		await expect(unified).toHaveAttribute("aria-pressed", "true");
		await expect.poll(() => renderedDiffType(page)).toBe("single");
	} finally {
		await viewer.stop();
	}
});

// CLI 뷰 플래그는 그 실행에만 적용된다 — 저장값을 바꾸지 않는다.
test("--split applies without overwriting the saved layout", async ({
	page,
}) => {
	const viewer = await launchViewer(["--split"]);
	try {
		// 저장값을 먼저 둬야 "덮어쓰지 않음"과 "애초에 안 씀"을 가른다.
		await page.addInitScript((k) => {
			if (localStorage.getItem(k) === null) localStorage.setItem(k, "unified");
		}, DIFF_STYLE_KEY);
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		await expect(
			page.locator('#diff-style-group [data-style="split"]'),
		).toHaveAttribute("aria-pressed", "true");
		expect(
			await page.evaluate((k) => localStorage.getItem(k), DIFF_STYLE_KEY),
		).toBe("unified");
	} finally {
		await viewer.stop();
	}
});
