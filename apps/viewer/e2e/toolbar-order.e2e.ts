// 순서의 이유는 viewer-toolbar.md "배치".
import { expect, launchViewer, test } from "./fixtures/app.ts";

// `.tb-right`에서 자리를 차지하는 컨트롤(닫힌 find 바는 뺀다).
const RIGHT_ORDER = [
	"find-open",
	"refresh",
	"diff-style-group",
	"tree-toggle-btn",
	"overflow-btn",
];

test.describe("toolbar groups", () => {
	test("the left group is a sentence and the right group is the controls", async ({
		page,
	}) => {
		const { url, stop } = await launchViewer([]);
		try {
			await page.goto(url);
			await expect(page.locator("#picker-name")).not.toBeEmpty();

			const groups = await page.evaluate(() => {
				const idsOf = (sel: string) =>
					[...(document.querySelector(sel)?.children ?? [])]
						.map((el) => el.id || el.className)
						.filter((s) => s !== "");
				return { left: idsOf(".tb-left"), right: idsOf(".tb-right") };
			});

			expect(groups.left).toEqual([
				"tb-picker",
				"pr-chip",
				"status",
				"change-totals",
			]);
			expect(groups.right).toEqual([
				"find-open",
				"find-bar",
				"refresh",
				"diff-style-group",
				"tree-toggle-btn",
				"tb-overflow",
			]);
		} finally {
			await stop();
		}
	});

	test("opening the find bar moves no other control", async ({ page }) => {
		const { url, stop } = await launchViewer([]);
		try {
			await page.goto(url);
			await expect(page.locator("#picker-name")).not.toBeEmpty();

			const lefts = () =>
				page.evaluate(
					(ids) =>
						Object.fromEntries(
							ids.map((id) => [
								id,
								Math.round(
									document.getElementById(id)?.getBoundingClientRect().left ??
										Number.NaN,
								),
							]),
						),
					RIGHT_ORDER,
				);

			const before = await lefts();
			// 돋보기 자신은 바가 열리면 사라지므로 비교 대상에서 뺀다.
			delete before["find-open"];

			await page.locator("#find-open").click();
			await expect(page.locator("#find-bar")).toBeVisible();
			// 바가 펼쳐지는 전이가 끝나기를 기다린다 — 중간 프레임을 재면 단언이
			// 전이 속도에 묶인다.
			await page.waitForTimeout(500);

			const after = await lefts();
			delete after["find-open"];
			expect(after).toEqual(before);
		} finally {
			await stop();
		}
	});

	test("the right group keeps its size when the window is narrow", async ({
		page,
	}) => {
		const { url, stop } = await launchViewer([]);
		try {
			await page.goto(url);
			await expect(page.locator("#picker-name")).not.toBeEmpty();
			const wide = await page
				.locator(".tb-right")
				.evaluate((el) => Math.round(el.getBoundingClientRect().width));

			await page.setViewportSize({ width: 560, height: 720 });
			await page.waitForTimeout(200);
			const narrow = await page.evaluate(() => {
				const right = document.querySelector(".tb-right");
				const toolbar = document.getElementById("toolbar");
				const label = document.getElementById("ref-picker-label");
				if (!right || !toolbar || !label)
					throw new Error("toolbar nodes missing");
				return {
					width: Math.round(right.getBoundingClientRect().width),
					rightEdge: Math.round(right.getBoundingClientRect().right),
					height: Math.round(toolbar.getBoundingClientRect().height),
					// 줄어드는 몫은 트리거가 진다.
					clipped: label.scrollWidth > label.clientWidth,
				};
			});

			expect(narrow.width).toBe(wide);
			expect(narrow.rightEdge).toBeLessThanOrEqual(560);
			expect(narrow.height).toBeLessThan(48);
			expect(narrow.clipped).toBe(true);
		} finally {
			await stop();
		}
	});
});
