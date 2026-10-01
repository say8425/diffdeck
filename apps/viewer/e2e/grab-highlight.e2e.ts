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

	// 앵커는 릴리스 지점의 0크기 rect라 팝오버가 그 바로 아래에 뜬다(파일
	// 상단이라 뷰포트 클램프에 걸리지 않는다).
	const box = await popover.boundingBox();
	if (!box) throw new Error("popover has no box");
	expect(Math.abs(box.x - to.x)).toBeLessThanOrEqual(2);
	expect(box.y).toBeGreaterThanOrEqual(to.y);
	expect(box.y - to.y).toBeLessThanOrEqual(20);
	// 행 rect를 앵커로 쓰면 행 왼쪽 끝에 뜬다.
	expect(box.x).toBeGreaterThan(a.x + 20);
});

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

	// 유닛의 .click()은 0크기여도 통과한다 — 실제로 페인트되는지 본다.
	await expect(page.locator("#grab-popover .grab-send")).toBeVisible();
	await expect(page.locator("#grab-popover .grab-send")).toHaveCSS(
		"background-color",
		"rgba(0, 0, 0, 0)",
	);
	// 첫 행부터 셋째 행까지 — 행마다 Range 하나.
	await expect.poll(() => highlightRangeCount(page)).toBe(3);

	// Range 등록만으로는 CSS 규칙이 깨진 것을 못 잡는다 — 규칙이 unsafeCSS
	// 통로로 shadow root에 들어갔는지 본다. 엔진이 @layer로 감싸므로 부분
	// 문자열로 비교한다.
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

// onGutterUtilityClick 진입부의 clear() 방어는 검증하지 않는다. 실제 제스처에서는
// 거터 pointerdown이 바깥 dismiss로 먼저 close()를 불러, 텍스트 드래그를 앞세워도
// 늘 통과하는 빈 절이 된다.
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

	// 한 셀 안의 드래그로 단일 side 선택을 만든다(grab.e2e.ts ①).
	const cell = container.locator("[data-column-number]").first();
	const c = await cell.boundingBox();
	if (!c) throw new Error("gutter cell not visible");
	const mid = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
	await dragSelect(page, mid, mid);

	await container.locator("[data-utility-button]").click();
	await expect(page.locator("#grab-popover")).toBeVisible();
	expect(
		await container.evaluate(
			(el) => el.shadowRoot?.querySelector("[data-selected-line]") != null,
		),
	).toBe(true);
	expect(await highlightRangeCount(page)).toBe(0);
});

// Range가 살아 있는 DOM을 가리키는지 본다 — 개수만 보면 재시딩을 빼도 통과한다.
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
		const from = { x: a.x + 40, y: a.y + a.height / 2 };
		const to = { x: b.x + b.width - 5, y: b.y + b.height / 2 };
		await dragSelect(page, from, to);
		await expect(page.locator("#grab-popover")).toBeVisible();

		const before = await highlightLiveness(page);
		expect(before.count).toBeGreaterThan(0);
		expect(before.allLive).toBe(true);

		// 렌더 윈도우 밖에서는 하이라이트가 없는 게 의도라 돌아온 뒤에만 단언한다.
		const diff = page.locator("#diff");
		const home = await diff.evaluate((el) => el.scrollTop);
		await diff.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		// 전제: 대상 파일이 실제로 언마운트돼야 재시딩을 검증한다.
		await expect(container).toHaveCount(0);

		await diff.evaluate((el, top) => {
			el.scrollTop = top;
		}, home);
		// 엔진이 다음 프레임에 위치를 보정할 수 있어 값이 멈춘 뒤에 본다.
		// app.ts의 waitForStableScrollTop은 0을 정착값으로 치지 않아(여기 home은
		// 0이다) 쓸 수 없다.
		let lastScrollTop = Number.NaN;
		await expect
			.poll(
				async () => {
					const value = await diff.evaluate((el) => el.scrollTop);
					const stable = value === lastScrollTop;
					lastScrollTop = value;
					return stable;
				},
				{ timeout: 15_000, intervals: [100] },
			)
			.toBe(true);
		await expect(container).toBeVisible();
		await waitForHighlighted(container);

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

		// 두 삭제 행을 가로지르면 old side 2..5 — 사이의 context 두 줄까지 4줄이다.
		const del = container.locator('[data-line][data-line-type*="deletion"]');
		await expect(del).toHaveCount(2);
		const first = await del.first().boundingBox();
		const last = await del.last().boundingBox();
		if (!first || !last) throw new Error("deletion rows not visible");
		const from = { x: first.x + 40, y: first.y + first.height / 2 };
		const to = { x: last.x + last.width - 5, y: last.y + last.height / 2 };
		await dragSelect(page, from, to);
		await expect(page.locator("#grab-popover")).toBeVisible();

		await page.locator("#grab-popover textarea").press("Enter");
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toContain("diffdeck selection");
		const out = await page.evaluate(() => navigator.clipboard.readText());
		expect(out).toContain("(old side");

		const fenced = out.split("\n");
		const open = fenced.findIndex((l) => /^`{3,}$/.test(l));
		const close = fenced.findIndex((l, i) => i > open && /^`{3,}$/.test(l));
		const body = fenced.slice(open + 1, close);
		const blank = body.findIndex((l) => l === "");
		const codeLines = body.slice(blank + 1);

		// 첫 줄만 x+40부터 잘리므로 접미사로 본다(잘리는 위치는 폰트마다 다르다).
		expect(codeLines).toHaveLength(4);
		expect("drop-1".endsWith(codeLines[0])).toBe(true);
		expect(codeLines.slice(1)).toEqual(["keep-b", "keep-c", "drop-2"]);

		// data-alt-line 폴백을 가르는 단언 — 빠지면 사이의 context 행이
		// 하이라이트에서만 빠진다.
		expect(await highlightRangeCount(page)).toBe(codeLines.length);
	} finally {
		await viewer.stop();
	}
});

test("⑥ 한 줄 안 부분 드래그 → 하이라이트와 클립보드가 같은 프래그먼트", async ({
	page,
	viewerUrl,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="README.md"]') });
	await expect(container).toBeVisible();
	await waitForHighlighted(container);

	const row = container.locator("[data-line]").first();
	const box = await row.boundingBox();
	if (!box) throw new Error("row not visible");

	// 한 행 안에서 x+40 → x+140(둘 다 텍스트 위).
	await dragSelect(
		page,
		{ x: box.x + 40, y: box.y + box.height / 2 },
		{ x: box.x + 140, y: box.y + box.height / 2 },
	);
	await expect(page.locator("#grab-popover")).toBeVisible();

	const probe = await page.evaluate(() => {
		const hl = (
			CSS as unknown as { highlights: Map<string, Set<Range>> }
		).highlights.get("diffdeck-grab");
		const ranges = hl ? [...hl] : [];
		return {
			count: ranges.length,
			text: ranges[0]?.toString() ?? "",
			rowText:
				ranges[0]?.startContainer.parentElement?.closest("[data-line]")
					?.textContent ?? "",
		};
	});
	expect(probe.count).toBe(1);
	expect(probe.text.length).toBeGreaterThan(0);
	expect(probe.text.length).toBeLessThan(probe.rowText.length);

	await page.locator("#grab-popover textarea").press("Enter");
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain("diffdeck selection");
	const out = await page.evaluate(() => navigator.clipboard.readText());
	// toContain은 줄 전체가 복사돼도 통과한다 — 본문을 정확히 비교한다.
	const lines = out.split("\n");
	const open = lines.findIndex((l) => /^`{3,}$/.test(l));
	const close = lines.findIndex((l, i) => i > open && /^`{3,}$/.test(l));
	const body = lines.slice(open + 1, close);
	const blank = body.findIndex((l) => l === "");
	expect(body.slice(blank + 1)).toEqual([probe.text]);
});

test("⑧ Shift+Enter로 여러 줄을 입력해도 개행 그대로 복사된다", async ({
	page,
	viewerUrl,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
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
	if (!a || !b) throw new Error("rows not visible");
	await dragSelect(
		page,
		{ x: a.x + 40, y: a.y + a.height / 2 },
		{ x: b.x + b.width - 5, y: b.y + b.height / 2 },
	);
	const popover = page.locator("#grab-popover");
	await expect(popover).toBeVisible();

	const box = popover.locator("textarea");
	await box.type("첫 줄");
	await box.press("Shift+Enter");
	await box.type("둘째 줄");
	await expect(popover).toBeVisible();
	expect(await box.inputValue()).toBe("첫 줄\n둘째 줄");

	await box.press("Enter");
	// Enter는 개행 기본 동작을 막아야 한다 — happy-dom은 기본 동작을 수행하지
	// 않아 유닛이 못 잡는다.
	expect(await box.inputValue()).toBe("첫 줄\n둘째 줄");

	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain("diffdeck selection");
	const out = await page.evaluate(() => navigator.clipboard.readText());
	expect(out).toContain("첫 줄\n둘째 줄");
	expect(out.trim().endsWith("둘째 줄")).toBe(true);
});

test('⑦ 거터 "+" 경로는 줄 전체를 잡는다 (문자 단위와 공존)', async ({
	page,
	viewerUrl,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="src/hello.ts"]') });
	await expect(container).toBeVisible();

	const cell = container.locator("[data-column-number]").first();
	const c = await cell.boundingBox();
	if (!c) throw new Error("gutter cell not visible");
	const mid = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
	await dragSelect(page, mid, mid);
	await container.locator("[data-utility-button]").click();
	await expect(page.locator("#grab-popover")).toBeVisible();

	await page.locator("#grab-popover textarea").press("Enter");
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain("diffdeck selection");
	const out = await page.evaluate(() => navigator.clipboard.readText());
	expect(out).toContain('export const hello = (): string => "hello";');
});

// `.grab-hint`가 sr-only라야 복사 뒤에도 높이가 같다(grab.md). 레이아웃이라
// 유닛은 못 잡는다.
test("⑨ 복사해도 창 높이가 변하지 않는다 — 상태는 버튼 색으로만", async ({
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
	const popover = page.locator("#grab-popover");
	await expect(popover).toBeVisible();

	// 복사 뒤 자동 닫힘과 경합하므로 상태와 높이를 한 번의 evaluate로 같은
	// 순간에 읽는다. close()는 data-state를 되돌리지 않아 닫힌 뒤에도 "ok"다 —
	// hidden을 함께 실어 닫힘을 높이 불일치와 가른다.
	const snapshot = (): Promise<{
		state: string;
		height: number;
		hidden: boolean;
	}> =>
		popover.evaluate((el) => ({
			state:
				(el.querySelector(".grab-send") as HTMLElement | null)?.dataset.state ??
				"",
			height: el.getBoundingClientRect().height,
			// hidden은 최신 DOM 타입에서 boolean | "until-found"라 불리언으로 좁힌다.
			hidden: Boolean((el as HTMLElement).hidden),
		}));

	const before = await snapshot();
	expect(before.hidden).toBe(false);
	expect(before.height).toBeGreaterThan(0);

	await page.locator("#grab-popover textarea").press("Enter");
	// 성공 상태를 먼저 기다린다 — 아무 일도 안 일어나 높이가 같은 빈 통과를 막는다.
	let after = before;
	await expect
		.poll(async () => {
			after = await snapshot();
			return after.state;
		})
		.toBe("ok");
	if (after.hidden) {
		throw new Error("팝오버가 사라졌다 — 자동 닫힘(400ms)이 먼저 발화했다");
	}
	expect(after.height).toBe(before.height);
});
