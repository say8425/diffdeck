// 서버가 진짜로(single-flight 타임아웃) 503을 내는 상황은 diff-server.test.ts
// (flightTimeoutMs 주입)가 실제 HTTP 왕복으로 검증한다. 여기서는 그 반대쪽
// 절반 — browser/main.ts의 fetchDiff가 503을 받았을 때 사용자 조작 없이도
// 스스로 재시도해 회복하는지 — 를 실브라우저로 검증한다. Playwright 라우팅으로
// 첫 /api/diff 요청만 503으로 가로채고 이후는 실서버로 통과시켜, 클라이언트
// 재시도 로직 자체를 결정적으로 겨냥한다(서버 타이밍에 기대지 않음).
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

		// 아무 조작도 하지 않는다(클릭·새로고침 없음) — fetchDiff의 내부
		// 재시도만으로 "Loading…"에서 실제 diff로 넘어가야 한다.
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
	} finally {
		await viewer.stop();
	}
});
