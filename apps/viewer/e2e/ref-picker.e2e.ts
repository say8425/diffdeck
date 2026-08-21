// 견줄 기준 피커: 툴바의 2지선다 <select>를 검색 가능한 목록으로 바꾼 것.
//
// 여기서만 잡히는 계약들이다 — happy-dom에는 레이아웃도 CSS 캐스케이드도
// 없어서 "[hidden]이 실제로 숨기는가", "패널이 정말 페인트되는가",
// "닫을 때 포커스가 트리거로 돌아오는가"를 유닛이 원리적으로 볼 수 없다.
import { expect, launchViewer, test } from "./fixtures/app.ts";

const OPTS = { featureBranchCommit: true, branches: ["develop"] };

test.describe("compare base picker", () => {
	test("opens to a searchable list and closes on Escape", async ({ page }) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			const panel = page.locator("#ref-picker");
			// author가 display를 선언한 노드라 [hidden] 짝이 없으면 처음부터
			// 열린 채로 보인다 — 이 단언이 그 규칙의 회귀망이다.
			await expect(panel).toBeHidden();

			await page.locator("#ref-picker-btn").click();
			await expect(panel).toBeVisible();
			await expect(page.locator("#ref-picker-btn")).toHaveAttribute(
				"aria-expanded",
				"true",
			);
			const rows = page.locator("#ref-picker .ref-row");
			await expect(rows.filter({ hasText: "Working tree" })).toHaveCount(1);
			await expect(rows.filter({ hasText: "develop" })).toHaveCount(1);

			await page.keyboard.press("Escape");
			await expect(panel).toBeHidden();
		} finally {
			await stop();
		}
	});

	test("filters the list as you type", async ({ page }) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			await page.locator("#ref-picker-btn").click();
			const rows = page.locator("#ref-picker .ref-row");
			// 목록은 /api/refs가 도착한 뒤에 채워진다. count()는 재시도하지
			// 않는 일회성 읽기라, 도착을 기다리는 단언을 먼저 둔다.
			await expect(rows.filter({ hasText: "develop" })).toHaveCount(1);
			expect(await rows.count()).toBeGreaterThan(1);
			await page.locator("#ref-picker-search").fill("develop");
			await expect(rows).toHaveCount(1);
			await expect(rows.first()).toHaveText(/develop/);
		} finally {
			await stop();
		}
	});

	// 기본값은 base=HEAD(미커밋만)이므로 브랜치에 커밋한 파일은 안 보인다.
	// main을 기준으로 고르면 merge-base가 갈림점으로 내려가 그 커밋까지 들어온다.
	test("choosing a branch widens the diff to the committed work", async ({
		page,
	}) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			await expect(page.locator("#ref-picker-label")).toHaveText(
				"Working tree",
			);
			const before = await page.locator("#status").textContent();

			await page.locator("#ref-picker-btn").click();
			await page
				.locator("#ref-picker .ref-row")
				.filter({ hasText: /^main/ })
				.first()
				.click();

			await expect(page.locator("#ref-picker-label")).toHaveText("vs main");
			await expect(page.locator("#status")).not.toHaveText(before ?? "");
			// 닫힌 뒤 포커스가 트리거로 돌아와야 키보드 사용자가 길을 잃지 않는다.
			await expect(page.locator("#ref-picker-btn")).toBeFocused();
		} finally {
			await stop();
		}
	});

	test("never shares the screen with the overflow menu", async ({ page }) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			await page.locator("#overflow-btn").click();
			await expect(page.locator("#overflow-menu")).toBeVisible();
			await page.locator("#ref-picker-btn").click();
			await expect(page.locator("#ref-picker")).toBeVisible();
			await expect(page.locator("#overflow-menu")).toBeHidden();
		} finally {
			await stop();
		}
	});
});
