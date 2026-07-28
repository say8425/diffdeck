// 이미 diff가 떠 있는 상태에서 갱신이 실패하면 화면을 지우지 않는다.
//
// load()는 첫 로드에만 로딩 인디케이터를 띄우고 이후 갱신은 기존 내용을 유지
// 하는데(`!lastFiles` 가드), 실패 경로에는 그 가드가 빠져 있어 언제나
// `diffMount.innerHTML = ...`로 패널을 덮어썼다. diffMount는 CodeView의 스크롤
// 컨테이너 그 자체라, 이 덮어쓰기는 CodeView가 setup 때 붙여 둔 컨테이너를
// 문서에서 떼어낸다. CodeView.setup()은 이미 setup된 인스턴스의 재부착을
// 거부하므로(`already setup`) 인스턴스를 새로 만들기 전에는 패널이 되살아나지
// 못한다.
//
// 예전에는 Unified/Split 토글이 CodeView를 통째로 재생성했기에 이 상태를
// 우연히 치유했다. 스크롤 보존을 위해 재생성을 없애면서 그 부작용도 사라졌으니
// (diffstyle-scroll.e2e.ts 참고), 근원인 실패 경로의 가드를 채운다.
//
// 서버를 죽이는 대신 Playwright 라우팅으로 /api/diff만 끊어 결정적으로 재현한다.
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
		// 마지막으로 성공한 diff가 그대로 남아 있어야 한다.
		await expect(page.locator("diffs-container")).toHaveCount(rendered);
	} finally {
		await viewer.stop();
	}
});

test("a failed refresh still shows the failure card when no diff is on screen", async ({
	page,
}) => {
	// 가드가 `!lastFiles`가 아니라 `!codeView`여야 하는 이유. 변경이 없는
	// 리포는 lastFiles === [] (truthy)지만 renderPatch가 teardownViews()로
	// 이미 codeView를 비운 뒤라 카드를 써도 안전하다 — `!lastFiles`로 걸면 이
	// 경우에 카드가 억제돼, 상태 라벨은 실패를 말하는데 화면은 빈 상태 카드를
	// 계속 주장하는 모순이 남는다.
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
		await expect(page.locator("#diff #empty")).toHaveText(/failed to load/i);
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

		// 스타일 전환은 서버 데이터를 다시 받지 않고 마지막 파일 목록으로 즉시
		// 재렌더한다 — 실패한 갱신 뒤에도 화면이 살아 있어야 한다.
		await page.locator('#diff-style-group [data-style="split"]').click();
		await expect
			.poll(() => renderedDiffType(page), { timeout: 10_000 })
			.toBe("split");
	} finally {
		await viewer.stop();
	}
});
