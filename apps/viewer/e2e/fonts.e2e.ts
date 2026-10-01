// 폰트 — UI는 Pretendard, 코드는 JetBrains Mono, 코드의 한글은 D2Coding.
//
// 유닛이 원리적으로 못 보는 계약이다: 두 vendored 엔진은 shadow DOM이라 페이지
// CSS가 닿지 않고, 폰트는 **커스텀 프로퍼티 상속**(`--diffs-font-family` 등)으로만
// 넘어간다. 그 통로가 끊기면 화면은 조용히 엔진 기본값(시스템 폰트)으로 떨어지고
// 아무것도 깨지지 않는다. 그래서 선언된 값이 아니라 **실제로 로드된 폰트**를 본다.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";

/** 선언된 FontFace 중 이름이 맞는 것들의 로드 상태. */
const statusOf = (page: Page, family: string): Promise<string[]> =>
	page.evaluate(
		(name) =>
			[...document.fonts]
				.filter((f) => f.family.replaceAll('"', "") === name)
				.map((f) => f.status),
		family,
	);

// 워커 하이라이트가 코드 줄 DOM을 갈아 끼우므로, 잡은 요소가 계산 직전에
// 떨어져 나가면 getComputedStyle이 빈 문자열을 준다(실측 — 반복 실행 5회 중 1회).
// 그래서 호출부는 expect.poll로 새 노드를 다시 잡는다.
const familyOf = (page: Page, selector: string): Promise<string> =>
	page
		.locator(selector)
		.first()
		.evaluate((el) => getComputedStyle(el).fontFamily);

test.describe("fonts", () => {
	test("① UI, file tree and diff headers use Pretendard; code uses JetBrains Mono", async ({
		page,
	}) => {
		const { url, stop } = await launchViewer([]);
		try {
			await page.goto(url);
			await expect(
				page.locator("diffs-container [data-line]").first(),
			).toBeVisible();
			await page.evaluate(() => document.fonts.ready);

			await expect
				.poll(() => familyOf(page, "body"))
				.toMatch(/^"Pretendard Variable"/);
			// shadow DOM 안 — 상속된 커스텀 프로퍼티로만 닿는다.
			await expect
				.poll(() => familyOf(page, "[data-item-path]"))
				.toMatch(/^"Pretendard Variable"/);
			await expect
				.poll(() => familyOf(page, "[data-diffs-header]"))
				.toMatch(/^"Pretendard Variable"/);
			await expect
				.poll(() => familyOf(page, "diffs-container [data-line]"))
				.toMatch(
					// 계산값은 따옴표를 정규화한다(공백 없는 이름은 벗긴다).
					/^"JetBrains Mono Variable", "?D2Coding"?,/,
				);

			// 선언만이 아니라 실제로 받아서 쓴다.
			expect(await statusOf(page, "Pretendard Variable")).toContain("loaded");
			expect(await statusOf(page, "JetBrains Mono Variable")).toContain(
				"loaded",
			);
			// 한글이 없는 diff에서는 D2Coding(1.5MB)을 받지 않는다 — 받는 중("loading")도
			// 아니어야 한다.
			expect(await statusOf(page, "D2Coding")).toEqual(["unloaded"]);
		} finally {
			await stop();
		}
	});

	// 리거처는 꺼져 있다 — 엔진이 읽는 `--diffs-font-features`로 넘긴다.
	test("⑤ code renders without ligatures", async ({ page }) => {
		const { url, stop } = await launchViewer([]);
		try {
			await page.goto(url);
			await expect
				.poll(() =>
					page
						.locator("diffs-container [data-line]")
						.first()
						.evaluate((el) => getComputedStyle(el).fontFeatureSettings),
				)
				.toBe('"calt" 0, "liga" 0');
		} finally {
			await stop();
		}
	});

	test("② Hangul in code falls back to D2Coding", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			writeFileSync(
				join(repoDir, "src", "hello.ts"),
				'export const hello = (): string => "hello, world"; // 안녕하세요\n',
			);
			await page.goto(url);
			await expect(
				page
					.locator("diffs-container [data-line]")
					.filter({ hasText: "안녕하세요" }),
			).toBeVisible();
			await page.evaluate(() => document.fonts.ready);
			await expect.poll(() => statusOf(page, "D2Coding")).toContain("loaded");
		} finally {
			await stop();
		}
	});

	// D2Coding의 unicode-range를 한글로 좁힌 것이 계약이다. 기준 글자는 **한자**다:
	// JetBrains Mono엔 없고 D2Coding엔 있다(둘 다 fontTools로 cmap 확인). 범위가
	// 없으면 브라우저가 그 한 글자를 그리려고 D2Coding 1.5MB를 받는다. ①의 "한글
	// 없으면 안 받는다"는 범위가 없어도 참이라 이걸 못 가른다. 기준 글자를 고를 때
	// 두 폰트의 cmap을 확인할 것 — 한때 박스 문자(─)였는데, JetBrains Mono를
	// 서브셋에서 전체 폰트로 바꾸자 JBM이 그 글자를 갖게 되어 판별력을 잃었다.
	test("③ non-Hangul glyphs JetBrains Mono lacks do not pull in D2Coding", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			writeFileSync(
				join(repoDir, "src", "hello.ts"),
				'export const hello = (): string => "hello, world"; // 漢字 box ─── →\n',
			);
			await page.goto(url);
			await expect(
				page.locator("diffs-container [data-line]").filter({ hasText: "漢字" }),
			).toBeVisible();
			await page.evaluate(() => document.fonts.ready);
			// 로드가 시작될 틈을 준다 — 범위가 없으면 여기서 loading/loaded가 된다.
			await page.waitForTimeout(500);
			expect(await statusOf(page, "D2Coding")).toEqual(["unloaded"]);
		} finally {
			await stop();
		}
	});

	// 코드의 기호가 전부 JetBrains Mono로 그려지는가 — 선언된 폰트가 아니라
	// **실제로 글리프를 그린 폰트**를 DevTools 프로토콜로 읽는다. 한때 Fontsource
	// 라틴 서브셋을 실었는데 화살표·수학 기호·박스 문자가 빠져 있어 그 글자만
	// OS 폰트(macOS Menlo, Linux DejaVu Sans Mono)로 그려졌다 — 계산된 font-family는
	// 그대로라 ①로는 원리적으로 안 보인다.
	test("④ arrows, math and box-drawing glyphs are drawn by JetBrains Mono", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			writeFileSync(
				join(repoDir, "src", "hello.ts"),
				"export const hello = (): string => 'a'; // → ⇒ ≠ ≤ ≥ ─ │ ┌ λ ∞\n",
			);
			await page.goto(url);
			const line = page
				.locator("diffs-container [data-line]")
				.filter({ hasText: "→ ⇒" })
				.first();
			await expect(line).toBeVisible();
			await page.evaluate(() => document.fonts.ready);

			const cdp = await page.context().newCDPSession(page);
			await cdp.send("DOM.enable");
			await cdp.send("CSS.enable");
			await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
			// 그 줄의 텍스트 노드마다 "실제로 글리프를 그린 폰트"를 묻는다. 워커
			// 하이라이트가 줄을 갈아 끼울 수 있어 poll이 매번 새로 찾는다.
			const renderedFamilies = async (): Promise<string[]> => {
				const count = await page.evaluate(() => {
					const texts: Text[] = [];
					for (const host of document.querySelectorAll("diffs-container")) {
						for (const row of host.shadowRoot?.querySelectorAll(
							"[data-line]",
						) ?? []) {
							if (!row.textContent?.includes("→ ⇒")) continue;
							const walker = document.createTreeWalker(
								row,
								NodeFilter.SHOW_TEXT,
							);
							for (let n = walker.nextNode(); n; n = walker.nextNode()) {
								texts.push(n as Text);
							}
						}
					}
					(globalThis as { ddTexts?: Text[] }).ddTexts = texts;
					return texts.length;
				});
				const families = new Set<string>();
				for (let i = 0; i < count; i++) {
					const { result } = await cdp.send("Runtime.evaluate", {
						expression: `globalThis.ddTexts[${i}]`,
					});
					const { nodeId } = await cdp.send("DOM.requestNode", {
						objectId: result.objectId as string,
					});
					const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", {
						nodeId,
					});
					for (const f of fonts) families.add(f.familyName);
				}
				return [...families].sort();
			};
			await expect.poll(renderedFamilies).toEqual(["JetBrains Mono"]);
		} finally {
			await stop();
		}
	});
});
