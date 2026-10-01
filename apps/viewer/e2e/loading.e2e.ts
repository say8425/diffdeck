// 첫 응답만 늦춘다 — 이후 갱신은 기존 내용을 유지하고 로딩을 띄우지 않는다.
import { expect, test } from "./fixtures/app.ts";

test("a slow first load shows a loading indicator until the diff arrives", async ({
	page,
	viewerUrl,
}) => {
	let delayed = false;
	await page.route("**/api/diff*", async (route) => {
		if (!delayed) {
			delayed = true;
			await new Promise((r) => setTimeout(r, 1500));
		}
		await route.continue();
	});

	await page.goto(viewerUrl);

	await expect(page.locator("#diff [data-loading]")).toBeVisible();

	await expect(page.locator("diffs-container").first()).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.locator("#diff [data-loading]")).toHaveCount(0);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
});
