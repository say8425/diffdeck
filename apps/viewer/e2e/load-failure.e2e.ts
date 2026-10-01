// 계약은 viewer.md의 innerHTML 항목. 서버를 죽이는 대신 /api/diff 라우팅만 끊어
// 실패를 결정적으로 만든다.
import {
	expect,
	launchViewer,
	renderedDiffType,
	test,
} from "./fixtures/app.ts";

test("a failed refresh keeps the rendered diff instead of wiping the panel", async ({
	page,
}) => {
	const viewer = await launchViewer([]);
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		const rendered = await page.locator("diffs-container").count();
		expect(rendered).toBeGreaterThan(0);

		await page.route("**/api/diff*", (route) => route.abort());
		await page.locator("#refresh").click();

		await expect(page.locator("#status")).toHaveText(/failed/i, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container")).toHaveCount(rendered);
	} finally {
		await viewer.stop();
	}
});

test("a failed refresh still shows the failure card when no diff is on screen", async ({
	page,
}) => {
	// 빈 리포는 lastFiles가 `[]`(truthy)지만 CodeView는 없다 — 가드가
	// `!codeView`가 아니라 `!lastFiles`면 여기서 카드가 억제된다.
	const viewer = await launchViewer([], { clean: true });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#empty")).toBeVisible({ timeout: 15_000 });
		await expect(page.locator("diffs-container")).toHaveCount(0);

		await page.route("**/api/diff*", (route) => route.abort());
		await page.locator("#refresh").click();

		await expect(page.locator("#status")).toHaveText(/failed/i, {
			timeout: 15_000,
		});
		// route.abort()는 네트워크 실패로 분류된다.
		await expect(page.locator("#diff #empty .empty-headline")).toHaveText(
			"Can't reach the diffdeck server",
		);
	} finally {
		await viewer.stop();
	}
});

test("the Unified/Split toggle still repaints after a failed refresh", async ({
	page,
}) => {
	const viewer = await launchViewer([]);
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		await expect
			.poll(() => renderedDiffType(page), { timeout: 10_000 })
			.toBe("single");

		await page.route("**/api/diff*", (route) => route.abort());
		await page.locator("#refresh").click();
		await expect(page.locator("#status")).toHaveText(/failed/i, {
			timeout: 15_000,
		});

		// 스타일 전환은 다시 받지 않고 마지막 파일 목록으로 그린다 — 라우팅이 끊긴
		// 채로도 다시 그려져야 한다.
		await page.locator('#diff-style-group [data-style="split"]').click();
		await expect
			.poll(() => renderedDiffType(page), { timeout: 10_000 })
			.toBe("split");
	} finally {
		await viewer.stop();
	}
});
