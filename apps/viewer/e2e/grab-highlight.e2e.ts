// grab 하이라이트 + 릴리스 지점 앵커 e2e.
// dragSelect·waitForHighlighted는 grab.e2e.ts와 공유하는 fixtures/drag.ts에
// 있다 — sleep 값·40px 오프셋의 튜닝 근거도 그쪽 헤더에 있다.
import { expect, test } from "./fixtures/app.ts";
import { dragSelect, waitForHighlighted } from "./fixtures/drag.ts";

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
