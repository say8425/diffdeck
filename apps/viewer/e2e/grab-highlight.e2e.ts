// grab 하이라이트 + 릴리스 지점 앵커 e2e.
// dragSelect 헬퍼의 유의사항은 grab.e2e.ts 헤더 주석과 동일하다:
// 합성 제스처는 각 단계 사이에 짧은 sleep이 필요하고(없으면 Chrome이
// mousedown 앵커를 못 잡아 selection이 빈다), 텍스트 드래그의 시작 x는
// 행 시작에서 40px 이상 띄워야 거터 "+" 버튼에 가로채이지 않는다.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/app.ts";

const dragSelect = async (
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
): Promise<void> => {
	await page.mouse.move(from.x, from.y);
	await page.waitForTimeout(30);
	await page.mouse.down();
	await page.waitForTimeout(30);
	await page.mouse.move(to.x, to.y, { steps: 10 });
	await page.waitForTimeout(30);
	await page.mouse.up();
	await page.waitForTimeout(80);
};

// 워커 하이라이트가 plain → 색 스팬으로 DOM을 교체하는 도중 boundingBox()를
// 읽으면 순간적으로 null이 된다. 색이 착지한 뒤에 좌표를 읽어 경합을 피한다.
const waitForHighlighted = (container: Locator) =>
	expect
		.poll(() =>
			container.evaluate(
				(el) => el.shadowRoot?.querySelector("pre span[style]") != null,
			),
		)
		.toBe(true);

test("① 팝오버는 드래그를 놓은 지점 옆에 뜬다", async ({ page, viewerUrl }) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="README.md"]') });
	await expect(container).toBeVisible();
	await waitForHighlighted(container);

	const rows = container.locator("[data-line]");
	const a = await rows.first().boundingBox();
	const b = await rows.nth(2).boundingBox();
	if (!a || !b) throw new Error("text rows not visible");
	const from = { x: a.x + 40, y: a.y + a.height / 2 };
	const to = { x: b.x + 60, y: b.y + b.height / 2 };

	await dragSelect(page, from, to);
	const popover = page.locator("#grab-popover");
	await expect(popover).toBeVisible();

	// computePlacement: left = clamp(anchor.left), top = anchor.bottom + GAP(6).
	// 릴리스 지점이 뷰포트 클램프에 걸리지 않는 위치(파일 상단)이므로 항등이다.
	const box = await popover.boundingBox();
	if (!box) throw new Error("popover has no box");
	expect(Math.abs(box.x - to.x)).toBeLessThanOrEqual(2);
	expect(box.y).toBeGreaterThanOrEqual(to.y);
	expect(box.y - to.y).toBeLessThanOrEqual(20);
	// 회귀 대상: 예전엔 행 rect(파일 컨테이너 왼쪽 끝)를 앵커로 써서
	// 커서에서 수백 px 왼쪽에 떴다.
	expect(box.x).toBeGreaterThan(a.x + 20);
});
