// grab 하이라이트 + 릴리스 지점 앵커 e2e.
// dragSelect·waitForHighlighted는 grab.e2e.ts와 공유하는 fixtures/drag.ts에
// 있다 — sleep 값·40px 오프셋의 튜닝 근거도 그쪽 헤더에 있다.
import type { Page } from "@playwright/test";
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

// Highlight는 setlike라 spread로 Range 목록을 얻는다.
const highlightRangeCount = (page: Page): Promise<number> =>
	page.evaluate(() => {
		const registry = (CSS as unknown as { highlights: Map<string, Set<Range>> })
			.highlights;
		const hl = registry.get("diffdeck-grab");
		return hl ? [...hl].length : 0;
	});

test("② 텍스트 드래그 → 잡은 행이 하이라이트되고, Esc로 닫으면 사라진다", async ({
	page,
	viewerUrl,
}) => {
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

	await dragSelect(
		page,
		{ x: a.x + 40, y: a.y + a.height / 2 },
		{ x: b.x + 60, y: b.y + b.height / 2 },
	);
	await expect(page.locator("#grab-popover")).toBeVisible();

	// README.md의 첫 3행(context 1·2 + context 3)을 가로질렀다 → new side 1..3.
	await expect.poll(() => highlightRangeCount(page)).toBe(3);

	await page.keyboard.press("Escape");
	await expect(page.locator("#grab-popover")).toBeHidden();
	await expect.poll(() => highlightRangeCount(page)).toBe(0);
});

// 거터 경로는 엔진 라인 선택(data-selected-line)이 칠하므로 grab 채널을
// 쓰지 않는다 — 이중 페인트가 없다는 것을 못박는다.
//
// 이 테스트가 검증하지 '않는' 것: onGutterUtilityClick 진입부의 clear() 방어.
// 그 방어는 "텍스트 팝오버가 열린 채 close()를 거치지 않고 거터 '+'로
// 진입"할 때만 의미가 있는데, 실제 포인터 제스처에서는 거터 드래그의
// pointerdown이 팝오버 바깥이라 document dismiss가 먼저 close()를 호출해
// onClosed가 이미 하이라이트를 지운다. 즉 e2e로는 도달 불가능한 방어라
// 여기서 텍스트 드래그를 선행시켜도 항상 통과하는 vacuous 절이 된다 —
// 그래서 넣지 않는다.
test("③ 거터 경로는 grab 하이라이트를 등록하지 않는다", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="src/hello.ts"]') });
	await expect(container).toBeVisible();

	// hello.ts의 거터 셀은 old/new 각 1개다. 한 셀 안에서 완결되는 드래그로
	// 단일 side 선택을 만든다(grab.e2e.ts ①과 같은 이유).
	const cell = container.locator("[data-column-number]").first();
	const c = await cell.boundingBox();
	if (!c) throw new Error("gutter cell not visible");
	const mid = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
	await dragSelect(page, mid, mid);

	await container.locator("[data-utility-button]").click();
	await expect(page.locator("#grab-popover")).toBeVisible();
	// 엔진 선택이 칠한다 — data-selected-line이 실제로 stamp됐는지 확인.
	expect(
		await container.evaluate(
			(el) => el.shadowRoot?.querySelector("[data-selected-line]") != null,
		),
	).toBe(true);
	// grab 채널은 비어 있어야 한다.
	expect(await highlightRangeCount(page)).toBe(0);
});
