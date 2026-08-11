// diff-grab e2e 15종: 거터/텍스트 두 경로 모두에서 실제 브라우저 제스처로
// 선택을 만들고(드래그·더블/트리플클릭), 팝오버·클립보드 인코딩까지 실
// Chrome으로 검증한다.
// happy-dom 유닛 테스트(grab/*.test.ts)는 순수 로직만 커버하므로,
// getComposedRanges 실측·엔진 옵션 활성화·recycle 생존·watch/find와의 상호작용은
// 여기서만 잡힌다.
//
// 드래그 헬퍼(dragSelect·waitForHighlighted)는 grab-highlight.e2e.ts와
// 공유하므로 fixtures/drag.ts에 있다 — sleep 값·40px 오프셋의 튜닝 근거도
// 그쪽 헤더에 있다.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";
import { dragSelect, waitForHighlighted } from "./fixtures/drag.ts";

const readClipboard = (page: Page): Promise<string> =>
	page.evaluate(() => navigator.clipboard.readText());

/**
 * 인코딩 문자열의 펜스 본문에서 코드 줄만 꺼낸다(머리말 3줄 + 빈 줄 뒤).
 *
 * `toContain`으로는 "줄 전체가 복사됐다"와 "단어만 복사됐다"를 가를 수 없다 —
 * 줄 전체도 단어를 포함하기 때문이다(grab-highlight ⑥이 실측으로 확인한 vacuous
 * 케이스). 문자 단위 스니펫을 단언하려면 본문을 정확히 꺼내 비교해야 한다.
 */
const fencedSnippet = (encoded: string): string[] => {
	const lines = encoded.split("\n");
	const open = lines.findIndex((l) => /^`{3,}$/.test(l));
	const close = lines.findIndex((l, i) => i > open && /^`{3,}$/.test(l));
	const body = lines.slice(open + 1, close);
	return body.slice(body.findIndex((l) => l === "") + 1);
};

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
	const input = page.locator("#grab-popover textarea");
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
	// 텍스트 드래그는 이제 문자 단위다 — 끝점을 행 텍스트 끝 너머로 잡아
	// 브라우저가 줄 끝으로 클램프하게 해야 마지막 줄이 온전히 복사된다
	// (몇 번째 문자에 떨어지는지는 폰트에 따라 달라진다).
	const to = { x: b.x + b.width - 5, y: b.y + b.height / 2 };

	// 트리거 버튼 없이 드래그 릴리스 직후 팝오버가 곧장 열린다(거터 "+" 경로와
	// 동일한 즉시성).
	await dragSelect(page, from, to);
	const popover = page.locator("#grab-popover");
	const input = page.locator("#grab-popover textarea");
	await expect(popover).toBeVisible();
	// 네이티브 선택은 popover.open()의 input.focus()가 문서 선택을 팝오버
	// input으로 옮기는 순간 죽는다(실측 — getComposedRanges가 #grab-popover의
	// 자식을 가리킨다). 대신 grab 하이라이트(::highlight(diffdeck-grab))가
	// 잡은 라인을 계속 보여준다 — 그 회귀망은 grab-highlight.e2e.ts다.
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
		const input = page.locator("#grab-popover textarea");
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
		// 끝점은 텍스트 끝 너머로 → 추가 행은 온전하다(위 ② 주석 참고).
		{ x: b.x + b.width - 5, y: b.y + b.height / 2 },
	);

	await expect(page.locator("#grab-popover")).toBeVisible();
	const input = page.locator("#grab-popover textarea");
	await expect(input).toBeFocused();
	await input.press("Enter");
	await expect.poll(() => readClipboard(page)).toContain("diffdeck selection");
	const out = await readClipboard(page);
	expect(out).toContain("Lines: old");
	// 삭제 행은 드래그 시작점(x+40)부터 잘리므로 줄 시작을 기대할 수 없다 —
	// 마커 뒤 본문이 원본의 접미사인지로 검증한다(폰트 메트릭 무관).
	const OLD_LINE = 'export const hello = (): string => "hello";';
	const minus = out.split("\n").find((l) => l.startsWith("-"));
	expect(minus).toBeDefined();
	expect(OLD_LINE.endsWith((minus ?? "").slice(1))).toBe(true);
	// 추가 행은 끝점을 텍스트 끝 너머로 잡았으므로 온전하다.
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
		const input = page.locator("#grab-popover textarea");
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
		await expect(page.locator("#grab-popover textarea")).toBeFocused();

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

test("⑧ 단순 클릭(드래그도 멀티클릭도 아님)은 팝오버를 열지 않는다 — 멀티클릭 게이트의 positive control", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// 단순 클릭은 애초에 선택 자체가 안 생기므로(진짜 collapsed range →
	// resolveSelectionRange가 null) 드래그 게이트(main.ts pointerup의
	// pointerDown/movedBeyondThreshold) 이전에도 걸러졌다. 그럼에도 이 테스트가
	// vacuous가 아닌 이유는 **멀티클릭 게이트** 때문이다: 더블/트리플클릭이
	// 팝오버를 열게 된 뒤(⑬⑭), 그 경로의 문턱값이 `click.detail >= 2`가 아니라
	// `>= 1`로 밀리면 평범한 클릭 한 번이 곧장 팝오버를 열어버린다. 이 단언이
	// 정확히 그 회귀를 잡는다.
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="README.md"]') });
	await expect(container).toBeVisible();
	await waitForHighlighted(container);

	const row = container.locator("[data-line]").first();
	const box = await row.boundingBox();
	if (!box) throw new Error("text row not visible");

	await page.mouse.click(box.x + 40, box.y + box.height / 2);
	// 두 경로 다 선택 확정을 한 틱(setTimeout 0) 뒤로 미루므로 그 이후까지
	// 기다렸다가 단언한다.
	await page.waitForTimeout(80);
	await expect(page.locator("#grab-popover")).toBeHidden();
});

test("⑬ 더블클릭 단어 선택도 팝오버를 연다 — 잡히는 건 줄 전체가 아니라 그 단어", async ({
	page,
	viewerUrl,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// 브라우저 네이티브 더블클릭은 마우스 이동 없이 단어 하나를 실제로
	// 선택한다. 드래그 게이트(이동거리 > 6px)만으로는 이 제스처가 통과하지
	// 못하므로, 멀티클릭은 click 이벤트의 detail로 따로 인지해야 한다
	// (pointerup.detail은 Chrome에서 항상 0 — 실측).
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="README.md"]') });
	await expect(container).toBeVisible();
	await waitForHighlighted(container);

	const row = container.locator("[data-line]").first();
	const box = await row.boundingBox();
	if (!box) throw new Error("text row not visible");
	const lineText = (await row.textContent()) ?? "";

	await page.mouse.click(box.x + 40, box.y + box.height / 2, {
		clickCount: 2,
	});

	const popover = page.locator("#grab-popover");
	await expect(popover).toBeVisible();
	const input = page.locator("#grab-popover textarea");
	await expect(input).toBeFocused();
	await input.press("Enter");
	await expect.poll(() => readClipboard(page)).toContain("diffdeck selection");
	const out = await readClipboard(page);
	expect(out).toContain("File: README.md");

	// 더블클릭 끝점은 양쪽 다 [data-line] 안에 직접 떨어지므로 chars(CharSpan)
	// 경로를 탄다 → 스니펫은 줄 전체가 아니라 그 단어여야 한다. toContain으로는
	// 판별이 안 된다(줄 전체도 단어를 포함한다 — grab-highlight ⑥과 같은 vacuous
	// 함정)이므로 펜스 본문을 꺼내 길이로 가른다.
	const snippet = fencedSnippet(out);
	expect(snippet).toHaveLength(1);
	expect(snippet[0].length).toBeGreaterThan(0);
	expect(lineText).toContain(snippet[0]);
	expect(snippet[0].length).toBeLessThan(lineText.length);
});

test("⑭ 트리플클릭은 줄 전체를 잡는다 — 같은 멀티클릭 경로가 detail 3까지 덮는다", async ({
	page,
	viewerUrl,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// 트리플클릭에는 전용 이벤트가 없다(dblclick은 두 번째 클릭에서 끝난다).
	// click.detail이 3으로 올라오는 것으로만 인지되므로, 게이트를 dblclick
	// 이벤트로 짰다면 세 번째 클릭의 문단 선택이 반영되지 않고 ⑬의 단어
	// 스니펫에 머문다 — 이 테스트가 그 구현 갈림길을 가른다.
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="README.md"]') });
	await expect(container).toBeVisible();
	await waitForHighlighted(container);

	const row = container.locator("[data-line]").first();
	const box = await row.boundingBox();
	if (!box) throw new Error("text row not visible");
	const lineText = (await row.textContent()) ?? "";

	await page.mouse.click(box.x + 40, box.y + box.height / 2, {
		clickCount: 3,
	});

	const input = page.locator("#grab-popover textarea");
	await expect(page.locator("#grab-popover")).toBeVisible();
	await expect(input).toBeFocused();
	await input.press("Enter");
	await expect.poll(() => readClipboard(page)).toContain("diffdeck selection");
	const out = await readClipboard(page);
	// 판별점은 "첫 줄이 단어가 아니라 줄 전체"다(⑬과 갈리는 지점). 그 뒤에 빈
	// 줄 하나가 더 붙는 것은 Chrome 문단 선택이 다음 행의 offset 0까지 걸치기
	// 때문이고, chars(CharSpan)가 그 끝점을 그대로 옮기므로 하이라이트도 똑같이
	// 거기서 끝난다 — "보이는 범위 == 복사되는 범위"는 유지된다.
	expect(fencedSnippet(out)[0]).toBe(lineText);
});

test("⑮ 파일 헤더(파일명) 더블클릭은 팝오버를 열지 않는다", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// ⑨(헤더 드래그)의 멀티클릭 판. resolveTextTarget의 "[data-line] 밖에서
	// 끝나는 선택은 null" 가드가 새 경로에도 그대로 걸리는지 확인한다 — 이
	// 가드가 새 경로에서 빠지면 파일명을 더블클릭하는 것만으로 팝오버가 뜬다.
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="README.md"]') });
	await expect(container).toBeVisible();
	await waitForHighlighted(container);

	const title = container.locator("[data-title]");
	const box = await title.boundingBox();
	if (!box) throw new Error("file title not visible");
	await page.mouse.click(box.x + 6, box.y + box.height / 2, { clickCount: 2 });

	// vacuous-test 가드: 더블클릭이 실제로 단어를 선택했는지부터 확인한다.
	await expect
		.poll(() => page.evaluate(() => document.getSelection()?.toString()))
		.not.toBe("");
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
	// vacuous-test 가드: 드래그가 실제로 텍스트를 선택했는지부터 확인한다 —
	// 그렇지 않으면(예: 폴드 버튼을 맞혀 아무 선택도 안 생김) 아래 "팝오버
	// 안 열림" 단언이 헤더 가드와 무관하게 항상 통과해버려 회귀를 못 잡는다.
	await expect
		.poll(() => page.evaluate(() => document.getSelection()?.toString()))
		.toContain("README");
	// pointerup 핸들러는 선택 확정을 한 틱(setTimeout 0) 뒤로 미루므로 그
	// 이후까지 기다렸다가 단언한다(⑧과 동일).
	await page.waitForTimeout(80);
	await expect(page.locator("#grab-popover")).toBeHidden();
});

test("⑩ 팝오버 Esc로 닫으면 엔진 라인 선택도 해제 — 스테일 선택이 호버 +를 막지 않는다", async ({
	page,
	viewerUrl,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// hello.ts는 old/new 각 1행뿐이라 거터 셀이 정확히 2개다. 하나를 선택해
	// 팝오버를 연 뒤 Esc로 닫고, 다른 셀을 호버해 "+"가 그쪽으로 옮겨오는지
	// 확인한다. 회귀 시나리오(수정 전): close()가 엔진 라인 선택을 지우지
	// 않으면 InteractionManager.placeUtility()가 활성 선택을 호버보다 우선해
	// (packages/diffs/src/managers/InteractionManager.ts:1110-1133) "+"를
	// 예전 선택 행에 계속 고정하거나, 그 행이 더 이상 대상이 아니면 아예
	// 숨겨버려 새로 호버한 행에는 뜨지 않는다.
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="src/hello.ts"]') });
	await expect(container).toBeVisible();

	const cells = container.locator("[data-column-number]");
	const first = await cells.first().boundingBox();
	if (!first) throw new Error("gutter cell not visible");
	await dragSelect(
		page,
		{ x: first.x + first.width / 2, y: first.y + first.height / 2 },
		{ x: first.x + first.width / 2, y: first.y + first.height / 2 },
	);
	await container.locator("[data-utility-button]").click();
	await expect(page.locator("#grab-popover")).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(page.locator("#grab-popover")).toBeHidden();

	await cells.nth(1).hover();
	await expect(cells.nth(1).locator("[data-utility-button]")).toBeVisible();
});

test("⑪ find 매치 하이라이트는 텍스트 경로 팝오버를 Esc로 닫아도 지워지지 않는다 — 선택 소유권은 거터 경로만 가진다", async ({
	page,
	viewerUrl,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// find로 hello.ts의 매치를 선택해 엔진 selectedLines 슬롯을 점유해 둔다
	// (revealMatch → codeView.setSelectedLines → data-selected-line 스탬프).
	await page.keyboard.press("Control+F");
	await page.locator("#find-input").fill("hello");
	await expect(page.locator("#find-count")).toHaveText(/\d+\/\d+/);
	await expect(page.locator("[data-selected-line]").first()).toBeVisible();
	const before = await page.locator("[data-selected-line]").count();

	// README.md에서 텍스트 드래그로 팝오버를 연다 — 텍스트 경로는
	// grabOwnsLineSelection 플래그를 세우지 않는다(main.ts의
	// onGutterUtilityClick에서만 세움). 이 팝오버는 find가 selectedLines
	// 슬롯을 소유하고 있는 걸 건드릴 권리가 없다.
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
		{ x: b.x + 40, y: b.y + b.height / 2 },
	);
	await expect(page.locator("#grab-popover")).toBeVisible();

	// 회귀 시나리오(소유권 플래그 없이 onClosed가 무조건 clearSelectedLines()를
	// 호출했던 이전 구현): 이 Esc가 텍스트 경로 팝오버 자신이 소유한 적도
	// 없는 find의 매치 선택까지 지워버렸다.
	await page.keyboard.press("Escape");
	await expect(page.locator("#grab-popover")).toBeHidden();

	expect(await page.locator("[data-selected-line]").count()).toBe(before);
});

// 버튼 클릭 경로는 유닛이 "이벤트를 취소했는가"까지만 볼 수 있다 — 포커스가
// 실제로 남는지는 실브라우저에서만 관측된다. 이게 무너지면(예: dismiss 리스너를
// capture 단계로 옮기거나 SVG에 pointer-events가 걸리면) 클릭이 복사 대신
// 팝오버를 닫아버리는데, 유닛은 전부 통과한 채로 지나간다.
test("⑫ 보내기 버튼 클릭도 Enter와 같이 복사하고, 입력 포커스를 잃지 않는다", async ({
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
	await expect(popover).toBeVisible();

	const input = page.locator("#grab-popover textarea");
	await input.fill("버튼으로 복사");
	await page.locator("#grab-popover .grab-send").click();

	await expect.poll(() => readClipboard(page)).toContain("diffdeck selection");
	const out = await readClipboard(page);
	expect(out).toContain("File: src/hello.ts");
	expect(out.trim().endsWith("버튼으로 복사")).toBe(true);

	// mousedown preventDefault의 진짜 계약 — 클릭해도 포커스가 input에 남는다.
	// 빠지면 IME 조합이 강제 확정돼 조합 중이던 글자가 누락된다.
	await expect(input).toBeFocused();
	// 팝오버는 살아 있다(바깥 클릭으로 오인되지 않았다) + 버튼은 성공 상태.
	await expect(popover).toBeVisible();
	await expect(page.locator("#grab-popover .grab-send")).toHaveAttribute(
		"data-state",
		"ok",
	);
});
