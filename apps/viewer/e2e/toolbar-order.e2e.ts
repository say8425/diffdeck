// 툴바의 두 축과 오른쪽 그룹의 순서.
//
// 왼쪽은 "지금 무엇을 보고 있는가"를 한 문장으로 말하고(트리거 · 견줄 기준 ·
// 개수 · 변경량), 오른쪽은 화면을 다룬다. 예전엔 뷰 모드와 새로고침이 왼쪽
// 한복판에 앉아 그 문장을 두 동강 냈다.
//
// **여기서만 잡히는 계약이 하나 있다**: find 바가 펼쳐질 때 다른 컨트롤이
// 움직이지 않는 것. 그건 레이아웃과 CSS 전이가 있어야 보이므로 happy-dom이
// 원리적으로 못 본다. 마크업 순서는 유닛으로도 볼 수 있지만, 그 순서의
// **이유**가 이 이동량이라 같은 파일에서 나란히 지킨다.
import { expect, launchViewer, test } from "./fixtures/app.ts";

/** `.tb-right` 안에서 실제로 자리를 차지하는 컨트롤들 (find 바는 숨김 상태). */
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

			// 왼쪽은 정보 넷뿐이다 — 조작은 트리거 하나이고 그건 곧 표식이다.
			expect(groups.left).toEqual([
				"tb-picker",
				"base-label",
				"status",
				"change-totals",
			]);
			// 오른쪽 순서: 순간 동작 → 상태 토글 → 나머지. `find-bar`가 돋보기
			// **바로 뒤**인 것도 계약이다 — 바는 그 자리에서 펼쳐지므로, 떼어
			// 놓으면 열 때 사이에 낀 컨트롤이 340px 밀린다.
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

	// **찾기가 맨 앞인 이유.** find 바는 돋보기 자리에서 340px로 펼쳐지는데,
	// 오른쪽 그룹은 오른쪽 끝에 고정돼 있어 바가 자라면 그 **왼쪽** 이웃만
	// 밀린다. 찾기가 첫 자리면 밀릴 이웃이 없다 — 실측: 세그먼트를 찾기 앞에
	// 두면 그 하나가 285px 왼쪽으로 점프한다.
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
			// 340px 확장 전이(0.28s)가 끝날 때까지 기다린다 — 중간 프레임을 재면
			// 이 단언이 전이 속도에 묶인다.
			await page.waitForTimeout(500);

			const after = await lefts();
			delete after["find-open"];
			expect(after).toEqual(before);
		} finally {
			await stop();
		}
	});

	// 오른쪽 그룹이 무거워졌으므로(세그먼트 118px가 늘었다) 좁은 창에서 눌리지
	// 않는지 확인한다. 줄어드는 몫은 여전히 트리거 혼자 진다.
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
					// 줄어드는 몫은 트리거가 전담한다는 기존 계약.
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
