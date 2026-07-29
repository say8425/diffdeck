// diff-grab e2e 9종: 거터/텍스트 두 경로 모두에서 실제 브라우저 드래그로
// 선택을 만들고, 팝오버·클립보드 인코딩까지 실 Chrome으로 검증한다.
// happy-dom 유닛 테스트(grab/*.test.ts)는 순수 로직만 커버하므로,
// getComposedRanges 실측·엔진 옵션 활성화·recycle 생존·watch/find와의 상호작용은
// 여기서만 잡힌다.
//
// 드래그 헬퍼 공통 유의사항(둘 다 실측으로 확인):
// 1. 합성 제스처(mouse.move/down/move/up)는 pollable하지 않다 — 각 단계
//    사이에 짧은 sleep을 넣지 않으면 Chrome이 mousedown 앵커를 못 잡고
//    selection이 비어버린다(steps만으로는 불충분, 실측 확인).
// 2. enableGutterUtility가 호버 중인 행 위에 20x20 "+" 버튼을 절대좌표로
//    띄우는데, 이 버튼이 행 콘텐츠 시작 지점에서 ~11px까지 겹친다. 텍스트
//    드래그의 시작 x좌표를 행 시작에서 5px만 띄우면 mousedown이 이 버튼을
//    맞혀 거터 경로로 가로채져 팝오버가 곧장 열려버린다 — 40px 이상 띄워야
//    실제 텍스트 위에서 시작한다. 텍스트 경로는 트리거 버튼 없이 pointerup
//    즉시 팝오버가 열린다(거터 "+" 경로와 동일한 즉시성).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const readClipboard = (page: Page): Promise<string> =>
	page.evaluate(() => navigator.clipboard.readText());

// 거터 셀·텍스트 행 공용 드래그 헬퍼: from → down → to(steps) → up.
// 각 단계 사이 sleep은 주석 1) 참고 — 실측으로 필요성을 확인했다.
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
// 읽으면 순간적으로 null이 된다(retokenize-cache 계열과 같은 근본 원인).
// 텍스트 행(gutter 셀이 아니라 [data-line])의 좌표를 읽는 스펙은 색이 실제로
// 착지한 뒤에 진행해 이 경합을 피한다.
const waitForHighlighted = (container: Locator) =>
	expect
		.poll(() =>
			container.evaluate(
				(el) => el.shadowRoot?.querySelector("pre span[style]") != null,
			),
		)
		.toBe(true);

test("① 거터 드래그 → + 클릭 → 프롬프트 → Enter → 인코딩 클립보드", async ({
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

	// hello.ts는 old/new 각 1행뿐이라 거터 셀도 딱 2개(각각 다른 side)다.
	// 두 셀을 가로지르면 old→new cross-side가 되어 "mixed" 인코딩이 나오므로,
	// 부분(단일 side) 범위를 만들려면 같은 셀 안에서 완결되는 드래그가 맞다.
	const cells = container.locator("[data-column-number]");
	const a = await cells.first().boundingBox();
	if (!a) throw new Error("gutter cell not visible");
	await dragSelect(
		page,
		{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
		{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
	);

	// 엔진 "+" 버튼 → 팝오버
	await container.locator("[data-utility-button]").click();
	const popover = page.locator("#grab-popover");
	await expect(popover).toBeVisible();
	await expect(popover).toBeInViewport();
	const input = page.locator("#grab-popover input");
	await expect(input).toBeFocused();
	await input.fill("여기 정리해줘");
	await input.press("Enter");
	await expect.poll(() => readClipboard(page)).toContain("diffdeck selection");
	const out = await readClipboard(page);
	expect(out).toContain("File: src/hello.ts");
	expect(out).toMatch(/Lines: \d+(-\d+)? \(/);
	expect(out.trim().endsWith("여기 정리해줘")).toBe(true);
});

test("② unified 텍스트 드래그 → 팝오버 즉시 오픈 → Escape 숨김 → 재드래그 → 빈 프롬프트 Enter", async ({
	page,
	viewerUrl,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// README.md는 순수 addition diff라 같은 side(new)에 걸친 여러 줄 드래그를
	// 만들 수 있다(hello.ts는 old/new 각 1행뿐이라 크로스사이드 전용 — ④).
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
	const to = { x: b.x + 40, y: b.y + b.height / 2 };

	// 트리거 버튼 없이 드래그 릴리스 직후 팝오버가 곧장 열린다(거터 "+" 경로와
	// 동일한 즉시성).
	await dragSelect(page, from, to);
	const popover = page.locator("#grab-popover");
	const input = page.locator("#grab-popover input");
	await expect(popover).toBeVisible();
	await expect(input).toBeFocused();

	// 회귀망: close()는 element.hidden 토글이라, CSS 쪽에서 [hidden] 우선순위가
	// 깨지면(예: display 강제 규칙) happy-dom 유닛 테스트는 절대 못 잡고
	// 실브라우저에서만 드러난다. Escape로 실제 화면에서 사라지는지 확인한 뒤,
	// 재드래그로 다시 즉시 열리는지까지 검증한다.
	await page.keyboard.press("Escape");
	await expect(popover).toBeHidden();

	await dragSelect(page, from, to);
	await expect(popover).toBeVisible();
	await expect(input).toBeFocused();
	await input.press("Enter");
	await expect.poll(() => readClipboard(page)).toContain("diffdeck selection");
	const out = await readClipboard(page);
	expect(out).toContain("diffdeck selection");
	expect(out).toContain("Base line.");
	// 빈 프롬프트 → 프롬프트 줄 없이 펜스로 끝난다.
	expect(out.trim().endsWith("```")).toBe(true);
});

test("③ split old side 텍스트 드래그 → 인코딩에 (old side, 포함", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const viewer = await launchViewer(["--split"]);
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		const container = page
			.locator("diffs-container")
			.filter({ has: page.locator('[data-fold="src/hello.ts"]') });
		await expect(container).toBeVisible();
		await waitForHighlighted(container);

		const oldRows = container.locator("code[data-deletions] [data-line]");
		const a = await oldRows.first().boundingBox();
		if (!a) throw new Error("old side row not visible");
		await dragSelect(
			page,
			{ x: a.x + 40, y: a.y + a.height / 2 },
			{ x: a.x + a.width - 5, y: a.y + a.height / 2 },
		);

		await expect(page.locator("#grab-popover")).toBeVisible();
		const input = page.locator("#grab-popover input");
		await expect(input).toBeFocused();
		await input.press("Enter");
		await expect
			.poll(() => readClipboard(page))
			.toContain("diffdeck selection");
		const out = await readClipboard(page);
		expect(out).toContain("(old side,");
	} finally {
		await viewer.stop();
	}
});

test("④ unified 크로스 사이드(삭제→추가) 텍스트 드래그 → old/new 마커 행", async ({
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
	await waitForHighlighted(container);

	const rows = container.locator("[data-line]");
	const a = await rows.first().boundingBox();
	const b = await rows.nth(1).boundingBox();
	if (!a || !b) throw new Error("text rows not visible");
	await dragSelect(
		page,
		{ x: a.x + 40, y: a.y + a.height / 2 },
		{ x: b.x + 40, y: b.y + b.height / 2 },
	);

	await expect(page.locator("#grab-popover")).toBeVisible();
	const input = page.locator("#grab-popover input");
	await expect(input).toBeFocused();
	await input.press("Enter");
	await expect.poll(() => readClipboard(page)).toContain("diffdeck selection");
	const out = await readClipboard(page);
	expect(out).toContain("Lines: old");
	expect(out).toMatch(/^-export const hello/m);
	expect(out).toMatch(/^\+export const hello/m);
});

test("⑤ 대량 스크롤(recycle) 이후에도 팝오버 생존 → Enter로 스냅샷 복사", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const viewer = await launchViewer([], { bulkFiles: 40 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		// diffs-container 첫 번째는 assets/logo.png(이미지 diff, 거터 없음)일
		// 수 있으므로 텍스트 파일을 명시적으로 지정한다.
		const container = page
			.locator("diffs-container")
			.filter({ has: page.locator('[data-fold="src/bulk-0.ts"]') });
		await expect(container).toBeVisible();

		const cells = container.locator("[data-column-number]");
		const a = await cells.first().boundingBox();
		if (!a) throw new Error("gutter cell not visible");
		await dragSelect(
			page,
			{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
			{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
		);
		await container.locator("[data-utility-button]").click();
		const popover = page.locator("#grab-popover");
		const input = page.locator("#grab-popover input");
		await expect(input).toBeFocused();

		// #diff를 실제 마우스 휠로 끝까지 밀어 CodeView 가상화가 bulk-0.ts를
		// 실제로 recycle(언마운트)하게 만든다 — 아래에서 컨테이너 소멸을
		// 직접 확인해 "가짜 성공"(recycle이 실은 안 일어남)을 배제한다.
		await page.mouse.move(600, 400);
		for (let i = 0; i < 40; i++) {
			await page.mouse.wheel(0, 20_000);
		}
		await expect.poll(() => container.count()).toBe(0);

		// 스펙: 스크롤은 팝오버를 닫지 않는다 — recycle로 앵커 DOM이 사라져도
		// 스냅샷(팝오버가 이미 쥐고 있는 데이터)은 불변이어야 한다.
		await expect(popover).toBeVisible();
		await expect(input).toBeFocused();

		await input.press("Enter");
		await expect
			.poll(() => readClipboard(page))
			.toContain("diffdeck selection");
		const out = await readClipboard(page);
		expect(out).toContain("File: src/bulk-0.ts");
	} finally {
		await viewer.stop();
	}
});

test("⑥ find 내비게이션은 grab 팝오버를 열지도, 열려 있는 팝오버를 닫지도 않는다", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	await page.keyboard.press("Control+F");
	await expect(page.locator("#find-bar")).toBeVisible();
	await page.locator("#find-input").fill("hello");
	await expect(page.locator("#find-count")).toHaveText(/\d+\/\d+/);

	const popover = page.locator("#grab-popover");
	await expect(popover).toBeHidden();
	for (let i = 0; i < 5; i++) {
		await page.locator("#find-input").press("Enter");
		await expect(popover).toBeHidden();
	}

	// 반대 방향(스펙의 나머지 절반): 팝오버가 hidden인 채 시작하면 grab 관련
	// 코드를 통째로 지워도 위 단언은 전부 통과해버린다(vacuous). 이번엔
	// 거터 "+"로 팝오버를 실제로 연 뒤, find-input에 포커스한 채 Enter로
	// 다음 매치를 순회해도 열린 팝오버가 유지되는지 검증한다 — 반드시
	// 키보드 경로여야 한다: find-bar의 prev/next 버튼 클릭은
	// mousedown/pointerdown을 던지므로 onDocDismiss가 (설계대로) 팝오버
	// 바깥 클릭으로 인식해 닫아버린다.
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="src/hello.ts"]') });
	await expect(container).toBeVisible();
	const cells = container.locator("[data-column-number]");
	const a = await cells.first().boundingBox();
	if (!a) throw new Error("gutter cell not visible");
	await dragSelect(
		page,
		{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
		{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
	);
	await container.locator("[data-utility-button]").click();
	await expect(popover).toBeVisible();

	for (let i = 0; i < 5; i++) {
		await page.locator("#find-input").press("Enter");
		await expect(popover).toBeVisible();
	}
});

test("⑦ watch 폴이 열려 있던 grab 팝오버를 닫는다", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const viewer = await launchViewer(["--watch"]);
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		const container = page
			.locator("diffs-container")
			.filter({ has: page.locator('[data-fold="src/hello.ts"]') });
		await expect(container).toBeVisible();

		const cells = container.locator("[data-column-number]");
		const a = await cells.first().boundingBox();
		if (!a) throw new Error("gutter cell not visible");
		await dragSelect(
			page,
			{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
			{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
		);
		await container.locator("[data-utility-button]").click();
		await expect(page.locator("#grab-popover input")).toBeFocused();

		// renderPatch(watch 폴이 실 변경을 감지했을 때만 호출됨 — 무변경
		// 폴은 304로 조기 반환돼 렌더를 건드리지 않는다)는 무조건 팝오버를
		// 닫는다. README.md를 편집해 다음 폴에서 200 + 재렌더를 유발한다.
		const readmePath = join(viewer.repoDir, "README.md");
		const original = readFileSync(readmePath, "utf8");
		writeFileSync(readmePath, `${original}\nWatched edit.\n`);

		await expect
			.poll(() => page.locator("#grab-popover").isHidden(), {
				timeout: 15_000,
			})
			.toBe(true);
	} finally {
		await viewer.stop();
	}
});

test("⑧ 단순 클릭(드래그 없음)은 팝오버를 열지 않는다", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// 트리거 제거 회귀망: 트리거가 있던 시절엔 hasSelection()(selectionchange
	// 리스너)이 "선택 없음"을 걸러 트리거를 숨겼다. 트리거를 없앤 지금은
	// pointerup 핸들러 안에서 resolveSelectionRange가 진짜 collapsed 선택
	// (드래그 없는 단순 클릭)을 null로 걸러내는 것이 유일한 방어선이다 —
	// 이게 깨지면 diff 영역의 모든 클릭이 팝오버를 띄우는 심각한 회귀가 된다.
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="README.md"]') });
	await expect(container).toBeVisible();
	await waitForHighlighted(container);

	const row = container.locator("[data-line]").first();
	const box = await row.boundingBox();
	if (!box) throw new Error("text row not visible");
	await page.mouse.click(box.x + 40, box.y + box.height / 2);
	// pointerup 핸들러는 선택 확정을 한 틱(setTimeout 0) 뒤로 미루므로 그
	// 이후까지 기다렸다가 단언한다.
	await page.waitForTimeout(80);
	await expect(page.locator("#grab-popover")).toBeHidden();
});

test("⑨ 파일 헤더(파일명) 텍스트 드래그는 팝오버를 열지 않는다", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// resolveTextTarget은 [data-line] 밖(헤더 등)에서 끝나는 드래그를 null로
	// 걸러낸다(rowsBetween이 빈 배열이면 target 없음). 트리거가 있던 시절엔
	// 이 경우도 "트리거 안 뜸"으로 조용히 무해했지만, 트리거 없이 pointerup
	// 즉시 여는 지금은 이 가드가 깨지면 곧장 팝오버가 열린다.
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="README.md"]') });
	await expect(container).toBeVisible();
	await waitForHighlighted(container);

	const title = container.locator("[data-title]");
	const box = await title.boundingBox();
	if (!box) throw new Error("file title not visible");
	await dragSelect(
		page,
		{ x: box.x + 2, y: box.y + box.height / 2 },
		{ x: box.x + box.width - 2, y: box.y + box.height / 2 },
	);
	await expect(page.locator("#grab-popover")).toBeHidden();
});
