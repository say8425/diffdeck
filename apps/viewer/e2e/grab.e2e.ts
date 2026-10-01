import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";
import { dragSelect, waitForHighlighted } from "./fixtures/drag.ts";

const readClipboard = (page: Page): Promise<string> =>
	page.evaluate(() => navigator.clipboard.readText());

/**
 * 인코딩 문자열의 펜스 본문에서 코드 줄만 꺼낸다(머리말 3줄 + 빈 줄 뒤).
 * `toContain`으로는 줄 전체와 단어를 가르지 못한다 — 줄도 단어를 포함한다.
 */
const fencedSnippet = (encoded: string): string[] => {
	const lines = encoded.split("\n");
	const open = lines.findIndex((l) => /^`{3,}$/.test(l));
	const close = lines.findIndex((l, i) => i > open && /^`{3,}$/.test(l));
	if (open < 0 || close < 0) {
		throw new Error(`no fenced block in encoded output: ${encoded}`);
	}
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

	// hello.ts의 거터 셀은 old·new 하나씩이다. 두 셀을 가로지르면 cross-side
	// (mixed)가 되므로 단일 side 범위는 한 셀 안에서 끝나는 드래그로 만든다.
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

	// README.md는 삭제가 없어 한 side(new)에서 여러 줄을 드래그할 수 있다.
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
	const to = { x: b.x + b.width - 5, y: b.y + b.height / 2 };

	await dragSelect(page, from, to);
	const popover = page.locator("#grab-popover");
	const input = page.locator("#grab-popover textarea");
	await expect(popover).toBeVisible();
	await expect(input).toBeFocused();

	// `#grab-popover[hidden]` 짝이 깨지면 실브라우저에서만 드러난다(viewer.md).
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
		{ x: b.x + b.width - 5, y: b.y + b.height / 2 },
	);

	await expect(page.locator("#grab-popover")).toBeVisible();
	const input = page.locator("#grab-popover textarea");
	await expect(input).toBeFocused();
	await input.press("Enter");
	await expect.poll(() => readClipboard(page)).toContain("diffdeck selection");
	const out = await readClipboard(page);
	expect(out).toContain("Lines: old");
	// 삭제 행은 시작점(x+40)부터 잘리므로 원본의 접미사인지만 본다(잘리는
	// 위치는 폰트마다 다르다).
	const OLD_LINE = 'export const hello = (): string => "hello";';
	const minus = out.split("\n").find((l) => l.startsWith("-"));
	expect(minus).toBeDefined();
	expect(OLD_LINE.endsWith((minus ?? "").slice(1))).toBe(true);
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

		// bulk-0.ts가 실제로 언마운트(recycle)됐는지 확인한다 — 안 하면 recycle
		// 없이도 통과한다.
		await page.mouse.move(600, 400);
		for (let i = 0; i < 40; i++) {
			await page.mouse.wheel(0, 20_000);
		}
		await expect.poll(() => container.count()).toBe(0);

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

	// 위 절반은 팝오버가 처음부터 닫혀 있어 grab 코드가 없어도 통과한다 — 연
	// 채로도 본다. 키보드(Enter)여야 한다: find 버튼 클릭은 팝오버 바깥
	// pointerdown이라 설계대로 팝오버를 닫는다.
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

		// 변경 없는 폴은 304라 renderPatch를 거치지 않는다 — 파일을 고쳐
		// 재렌더를 일으킨다.
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

test("⑧ 단순 클릭(드래그도 멀티클릭도 아님)은 팝오버를 열지 않는다", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// 멀티클릭 문턱(`detail >= 2`)의 가드가 아니다 — 단순 클릭은 선택을 만들지
	// 않아 `>= 1`로 풀어도 통과한다(grab.md). 평범한 클릭이 팝오버를 열지
	// 않는다는 스모크 체크다.
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="README.md"]') });
	await expect(container).toBeVisible();
	await waitForHighlighted(container);

	const row = container.locator("[data-line]").first();
	const box = await row.boundingBox();
	if (!box) throw new Error("text row not visible");

	await page.mouse.click(box.x + 40, box.y + box.height / 2);
	// 선택 확정이 한 틱(setTimeout 0) 뒤라 그 뒤에 "열리지 않음"을 단언한다.
	await page.waitForTimeout(80);
	await expect(page.locator("#grab-popover")).toBeHidden();
});

test("⑨ 파일 헤더(파일명) 텍스트 드래그는 팝오버를 열지 않는다", async ({
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

	const title = container.locator("[data-title]");
	const box = await title.boundingBox();
	if (!box) throw new Error("file title not visible");
	await dragSelect(
		page,
		{ x: box.x + 2, y: box.y + box.height / 2 },
		{ x: box.x + box.width - 2, y: box.y + box.height / 2 },
	);
	// 드래그가 실제로 텍스트를 선택했는지 먼저 본다 — 선택이 없으면(예: 폴드
	// 버튼을 맞힘) 아래 단언이 헤더 가드와 무관하게 통과한다.
	await expect
		.poll(() => page.evaluate(() => document.getSelection()?.toString()))
		.toContain("README");
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

	// find 매치가 엔진의 선택 슬롯(data-selected-line)을 차지하게 해 둔다.
	await page.keyboard.press("Control+F");
	await page.locator("#find-input").fill("hello");
	await expect(page.locator("#find-count")).toHaveText(/\d+\/\d+/);
	await expect(page.locator("[data-selected-line]").first()).toBeVisible();
	const before = await page.locator("[data-selected-line]").count();

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

	await page.keyboard.press("Escape");
	await expect(page.locator("#grab-popover")).toBeHidden();

	expect(await page.locator("[data-selected-line]").count()).toBe(before);
});

// 유닛은 이벤트를 취소했는지까지만 본다 — 클릭 뒤 입력 포커스가 실제로
// 남는지(IME 조합 보존, grab.md)는 실브라우저에서만 보인다.
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

	await expect(input).toBeFocused();
	await expect(popover).toBeVisible();
	await expect(page.locator("#grab-popover .grab-send")).toHaveAttribute(
		"data-state",
		"ok",
	);
});

test("⑬ 더블클릭 단어 선택도 팝오버를 연다 — 잡히는 건 줄 전체가 아니라 그 단어", async ({
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
	// 첫 줄만 본다 — Chrome의 문단 선택은 다음 행 offset 0까지 걸쳐 빈 줄이
	// 하나 더 붙는다.
	expect(fencedSnippet(out)[0]).toBe(lineText);
});

test("⑮ 파일 헤더(파일명) 더블클릭은 팝오버를 열지 않는다", async ({
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

	// 파일을 먼저 접어 둔다. 펼친 채 더블클릭하면 첫 클릭이 폴드 토글을 쳐 행이
	// 0개가 되고, 헤더 가드와 무관하게 통과한다. 접어 두면 첫 클릭이 도로 펼쳐
	// 행이 살아 있다.
	const title = container.locator("[data-title]");
	await title.click();
	await expect(container.locator("[data-line]")).toHaveCount(0);

	const box = await title.boundingBox();
	if (!box) throw new Error("file title not visible");
	await page.mouse.click(box.x + 6, box.y + box.height / 2, { clickCount: 2 });

	// 빈 통과 가드: 더블클릭이 단어를 선택했고, 그때 행이 렌더돼 있는가.
	await expect
		.poll(() => page.evaluate(() => document.getSelection()?.toString()))
		.not.toBe("");
	await expect(container.locator("[data-line]").first()).toBeVisible();
	await page.waitForTimeout(80);
	await expect(page.locator("#grab-popover")).toBeHidden();
});

test("⑯ 라인넘버 드래그는 아무 줄도 선택하지 않는다 — 클릭 한 줄 선택은 유지", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// README.md는 삭제가 없어 번호 셀이 한 side로 이어진다 — 여러 셀을
	// 가로지르는 세로 드래그를 만들 수 있다.
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="README.md"]') });
	await expect(container).toBeVisible();
	await waitForHighlighted(container);

	const selectedCount = (): Promise<number> =>
		container.evaluate(
			(el) =>
				el.shadowRoot?.querySelectorAll("[data-selected-line]").length ?? 0,
		);

	const cells = container.locator("[data-column-number]");
	const a = await cells.first().boundingBox();
	const b = await cells.nth(2).boundingBox();
	if (!a || !b) throw new Error("gutter cells not visible");

	await dragSelect(
		page,
		{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
		{ x: b.x + b.width / 2, y: b.y + b.height / 2 },
	);
	await page.waitForTimeout(80);
	expect(await selectedCount()).toBe(0);

	await dragSelect(
		page,
		{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
		{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
	);
	await expect.poll(selectedCount).toBeGreaterThan(0);
});

test("⑰ ⌥+Enter는 프롬프트·머리말 없이 잡은 코드만 클립보드로", async ({
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
	if (!a || !b) throw new Error("text rows not visible");
	await dragSelect(
		page,
		{ x: a.x + 40, y: a.y + a.height / 2 },
		{ x: b.x + b.width - 5, y: b.y + b.height / 2 },
	);
	const popover = page.locator("#grab-popover");
	const input = page.locator("#grab-popover textarea");
	await expect(popover).toBeVisible();
	await expect(popover.locator(".grab-keys")).toHaveText("⌥⏎ Copy code only");

	await input.fill("이 프롬프트는 무시된다");
	await input.press("Alt+Enter");
	const out = await readClipboard(page);
	expect(out).not.toContain("diffdeck selection");
	expect(out).not.toContain("```");
	expect(out).not.toContain("이 프롬프트는 무시된다");
	expect(out).toContain("Base line.");
	await expect(popover).toBeHidden();
});

test("⑱ 드래그를 끈 거터도 shift클릭 확장과 재클릭 해제는 그대로", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// vendored 예외 5의 클릭 쪽 회귀망 — shift 확장·재클릭 해제 분기는 이
	// 스펙만 지킨다(grab.md).
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="README.md"]') });
	await expect(container).toBeVisible();
	await waitForHighlighted(container);

	const selectedCount = (): Promise<number> =>
		container.evaluate(
			(el) =>
				el.shadowRoot?.querySelectorAll("[data-selected-line]").length ?? 0,
		);

	const cells = container.locator("[data-column-number]");
	const a = await cells.first().boundingBox();
	const c = await cells.nth(2).boundingBox();
	if (!a || !c) throw new Error("gutter cells not visible");
	const center = (b: {
		x: number;
		y: number;
		width: number;
		height: number;
	}) => ({
		x: b.x + b.width / 2,
		y: b.y + b.height / 2,
	});

	// 개수는 스탬프 수다 — unified는 선택된 행마다 번호 셀·내용 셀 둘에
	// 찍는다(한 줄 = 2, 세 줄 = 6).
	await dragSelect(page, center(a), center(a));
	await expect.poll(selectedCount).toBe(2);

	await page.keyboard.down("Shift");
	await dragSelect(page, center(c), center(c));
	await page.keyboard.up("Shift");
	await expect.poll(selectedCount).toBe(6);

	// 확장된 선택 안의 첫 행을 누르면 해제가 아니라 그 한 줄로 좁혀진다.
	await dragSelect(page, center(a), center(a));
	await expect.poll(selectedCount).toBe(2);

	await dragSelect(page, center(a), center(a));
	await expect.poll(selectedCount).toBe(0);
});

test("⑲ 라벨 줄의 ✕는 줄 높이를 늘리지 않고, 누르면 Esc와 같이 닫힌다 — 거터 선택까지", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// 거터 경로로 연다 — 텍스트 경로는 지울 엔진 선택이 없어 해제 단언이 빈
	// 통과가 된다.
	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="src/hello.ts"]') });
	await expect(container).toBeVisible();
	const selectedCount = (): Promise<number> =>
		container.evaluate(
			(el) =>
				el.shadowRoot?.querySelectorAll("[data-selected-line]").length ?? 0,
		);

	const cell = await container
		.locator("[data-column-number]")
		.first()
		.boundingBox();
	if (!cell) throw new Error("gutter cell not visible");
	const center = { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
	await dragSelect(page, center, center);
	await container.locator("[data-utility-button]").click();
	const popover = page.locator("#grab-popover");
	await expect(popover).toBeVisible();
	expect(await selectedCount()).toBeGreaterThan(0);

	// 버튼이 라벨 줄을 키우면 팝오버 높이가 POPOVER_SIZE와 어긋난다(grab.md).
	// 줄 높이를 읽으면 CSS를 되읽을 뿐이라 버튼을 뺀 팝오버 높이와 견준다.
	const close = popover.locator(".grab-close");
	const box = await popover.boundingBox();
	const btn = await close.boundingBox();
	if (!box || !btn) throw new Error("popover parts not visible");
	const withoutButton = await close.evaluate((el) => {
		const pop = el.closest("#grab-popover") as HTMLElement;
		(el as HTMLElement).style.display = "none";
		const h = pop.getBoundingClientRect().height;
		(el as HTMLElement).style.display = "";
		return h;
	});
	expect(box.height).toBe(withoutButton);
	// 팝오버 패딩(8px) 안쪽의 오른쪽 위에 붙는다.
	expect(box.x + box.width - (btn.x + btn.width)).toBeLessThanOrEqual(8);
	expect(btn.y - box.y).toBeLessThanOrEqual(8);

	await close.click();
	await expect(popover).toBeHidden();
	await expect.poll(selectedCount).toBe(0);
});
