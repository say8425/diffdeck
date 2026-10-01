// 폰트 연결이 끊겨도 조용히 시스템 폰트로 떨어질 뿐이라, 선언값이 아니라 실제로
// 로드되고 글리프를 그린 폰트를 본다(fonts.md).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const statusOf = (page: Page, family: string): Promise<string[]> =>
	page.evaluate(
		(name) =>
			[...document.fonts]
				.filter((f) => f.family.replaceAll('"', "") === name)
				.map((f) => f.status),
		family,
	);

// 워커 하이라이트가 줄 DOM을 갈아 끼우는 순간 떨어진 요소는 빈 값을 준다 —
// 호출부는 expect.poll로 새 노드를 다시 잡는다.
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

			expect(await statusOf(page, "Pretendard Variable")).toContain("loaded");
			expect(await statusOf(page, "JetBrains Mono Variable")).toContain(
				"loaded",
			);
			// 한글이 없는 diff에서는 D2Coding을 받지 않는다 — "loading"도
			// 아니어야 한다.
			expect(await statusOf(page, "D2Coding")).toEqual(["unloaded"]);
		} finally {
			await stop();
		}
	});

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

	// 기준 글자(한자)는 JetBrains Mono엔 없고 D2Coding엔 있어야 unicode-range가
	// 빠졌을 때 실패한다 — 바꿀 때 두 폰트의 cmap을 확인한다. ①은 범위가
	// 없어도 통과한다.
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

	// 폴백 글리프는 계산된 font-family에 드러나지 않는다 — 실제로 글리프를 그린
	// 폰트를 CDP로 읽는다.
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
			// 워커 하이라이트가 줄을 갈아 끼울 수 있어 poll마다 텍스트 노드를
			// 새로 찾는다.
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
