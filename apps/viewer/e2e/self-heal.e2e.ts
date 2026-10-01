// 서버 쪽 503은 diff-server.test.ts가 본다. 여기서는 첫 /api/diff만 라우팅으로
// 503을 줘 fetchDiff의 재시도를 서버 타이밍 없이 겨냥한다.
import { expect, launchViewer, test } from "./fixtures/app.ts";

test("a single 503 from the diff endpoint self-heals without any user action", async ({
	page,
}) => {
	const viewer = await launchViewer([]);
	try {
		let served503 = false;
		await page.route("**/api/diff*", async (route) => {
			if (!served503) {
				served503 = true;
				await route.fulfill({
					status: 503,
					headers: { "retry-after": "1" },
					body: "diff pipeline busy, retry shortly",
				});
				return;
			}
			await route.continue();
		});

		await page.goto(viewer.url);

		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
	} finally {
		await viewer.stop();
	}
});
