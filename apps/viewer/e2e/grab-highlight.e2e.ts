// grab 하이라이트 + 릴리스 지점 앵커 e2e.
// dragSelect·waitForHighlighted는 grab.e2e.ts와 공유하는 fixtures/drag.ts에
// 있다 — sleep 값·40px 오프셋의 튜닝 근거도 그쪽 헤더에 있다.
import type { Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";
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

	// Range 등록(위 poll)만으로는 CSS 규칙 자체가 깨져도(오타·중괄호 누락 등)
	// 못 잡는다 — 등록된 Range가 실제로 칠해지려면 규칙이 엔진의 unsafeCSS
	// 통로(File.ts의 style[data-unsafe-css])를 통해 shadow root에 살아
	// 있어야 한다. 이름과 background-color 선언이 붙어 있는 형태로 확인한다
	// (엔진의 wrapUnsafeCSS가 @layer 래핑·들여쓰기를 앞뒤로 씌우지만 우리
	// 규칙 문자열 자체는 그대로 보존되므로, 이 부분 문자열은 공백에 취약하지
	// 않다 — 전체 textContent 완전 일치만 피한다).
	const unsafeCSSText = await container.evaluate(
		(el) => el.shadowRoot?.querySelector("style[data-unsafe-css]")?.textContent,
	);
	expect(unsafeCSSText).toContain(
		"::highlight(diffdeck-grab){background-color",
	);

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

// Range가 "등록돼 있다"가 아니라 "지금 살아 있는 DOM을 가리킨다"를 본다.
// has()/size만 보면 재시딩 코드를 통째로 빼도 통과하는 vacuous 테스트가 된다.
const highlightLiveness = (page: Page) =>
	page.evaluate(() => {
		const registry = (CSS as unknown as { highlights: Map<string, Set<Range>> })
			.highlights;
		const hl = registry.get("diffdeck-grab");
		if (!hl) return { count: 0, allLive: false };
		const ranges = [...hl];
		return {
			count: ranges.length,
			allLive: ranges.every((r) => {
				const node = r.startContainer;
				const el =
					node instanceof Element
						? node
						: (node.parentElement as Element | null);
				return (
					el != null && el.isConnected && el.closest("[data-line]") != null
				);
			}),
		};
	});

test("④ 멀리 스크롤했다 되돌아오면 하이라이트가 다시 칠해진다", async ({
	page,
}) => {
	// bulkFiles로 diff를 스크롤 가능하게 만든다 — 기본 픽스처는 뷰포트보다
	// 짧아 아무것도 스크롤되지 않아 recycle이 일어나지 않는다.
	const viewer = await launchViewer([], { bulkFiles: 12 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		const container = page
			.locator("diffs-container")
			.filter({ has: page.locator('[data-fold="src/bulk-0.ts"]') });
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

		const before = await highlightLiveness(page);
		expect(before.count).toBeGreaterThan(0);
		expect(before.allLive).toBe(true);

		// 멀리 갔다가 되돌아온다. 파일이 렌더 윈도우 밖일 때 하이라이트가
		// 없는 것은 의도된 동작이므로, 돌아온 뒤에만 단언한다.
		const diff = page.locator("#diff");
		const home = await diff.evaluate((el) => el.scrollTop);
		await diff.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await page.waitForTimeout(300);
		await diff.evaluate((el, top) => {
			el.scrollTop = top;
		}, home);
		await page.waitForTimeout(300);
		await waitForHighlighted(container);

		// 팝오버는 스크롤로 닫히지 않는다(스냅샷 기반).
		await expect(page.locator("#grab-popover")).toBeVisible();
		await expect
			.poll(async () => (await highlightLiveness(page)).count)
			.toBe(before.count);
		expect((await highlightLiveness(page)).allLive).toBe(true);
	} finally {
		await viewer.stop();
	}
});

test("⑤ unified old-side가 context를 가로지르면 하이라이트 행 수 == 복사 라인 수", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const viewer = await launchViewer([], { contextBetweenDeletions: true });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		const container = page
			.locator("diffs-container")
			.filter({ has: page.locator('[data-fold="src/ctx.ts"]') });
		await expect(container).toBeVisible();
		await waitForHighlighted(container);

		// unified 렌더: keep-a / -drop-1 / keep-b / keep-c / -drop-2 / keep-d
		// 두 삭제행을 가로지르면 old side 2..5 → deletionLines.slice(1,5) =
		// drop-1·keep-b·keep-c·drop-2 = 4줄이 복사된다.
		const del = container.locator('[data-line][data-line-type*="deletion"]');
		await expect(del).toHaveCount(2);
		const first = await del.first().boundingBox();
		const last = await del.last().boundingBox();
		if (!first || !last) throw new Error("deletion rows not visible");
		await dragSelect(
			page,
			{ x: first.x + 40, y: first.y + first.height / 2 },
			{ x: last.x + 60, y: last.y + last.height / 2 },
		);
		await expect(page.locator("#grab-popover")).toBeVisible();

		await page.locator("#grab-popover input").press("Enter");
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toContain("diffdeck selection");
		const out = await page.evaluate(() => navigator.clipboard.readText());
		expect(out).toContain("(old side");

		// 펜스 사이 본문 줄 수 = 복사되는 라인 수.
		const fenced = out.split("\n");
		const open = fenced.findIndex((l) => /^`{3,}$/.test(l));
		const close = fenced.findIndex((l, i) => i > open && /^`{3,}$/.test(l));
		const body = fenced.slice(open + 1, close);
		const blank = body.findIndex((l) => l === "");
		const codeLines = body.slice(blank + 1);
		expect(codeLines).toEqual(["drop-1", "keep-b", "keep-c", "drop-2"]);

		// 순진한 side 비교 구현이면 2가 나온다(context 2행이 빠진다).
		expect(await highlightRangeCount(page)).toBe(codeLines.length);
	} finally {
		await viewer.stop();
	}
});
