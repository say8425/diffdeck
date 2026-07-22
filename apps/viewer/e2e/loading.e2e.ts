// 첫 로드(콜드) 로딩 표시: 아직 아무것도 렌더되지 않은 상태에서 /api/diff가
// 오래 걸리면 diff 패널에 로딩 인디케이터가 보이고, 응답이 도착하면 실제
// diff로 대체된다. Playwright route로 첫 응답만 인위 지연해 콜드 구간을
// 재현한다 — 이후 갱신(폴/토글)은 기존 내용을 유지하므로 로딩을 띄우지
// 않는 것이 의도된 동작이다.
import { expect, test } from "./fixtures/app.ts";

test("a slow first load shows a loading indicator until the diff arrives", async ({
	page,
	viewerUrl,
}) => {
	let delayed = false;
	await page.route("**/api/diff*", async (route) => {
		// 첫 요청만 지연 — 이후 요청(watch/focus)은 그대로 통과.
		if (!delayed) {
			delayed = true;
			await new Promise((r) => setTimeout(r, 1500));
		}
		await route.continue();
	});

	await page.goto(viewerUrl);

	// 지연 구간: 로딩 인디케이터가 diff 패널에 보인다.
	await expect(page.locator("#diff [data-loading]")).toBeVisible();

	// 응답 도착 후: 로딩은 사라지고 diff가 렌더된다.
	await expect(page.locator("diffs-container").first()).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.locator("#diff [data-loading]")).toHaveCount(0);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
});
