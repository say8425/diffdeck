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
			// 한글이 없는 diff에서는 D2Coding(1.5MB)을 받지 않는다.
			expect(await statusOf(page, "D2Coding")).not.toContain("loaded");
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

	// D2Coding의 unicode-range를 한글로 좁힌 것이 계약이다. JetBrains Mono는
	// 라틴 서브셋만 실어서 박스 문자(─) 같은 글자가 없는데, 범위가 없으면
	// 브라우저가 그 한 글자를 그리려고 다음 폴백인 D2Coding 1.5MB를 받는다.
	// ①의 "한글 없으면 안 받는다"는 범위가 없어도 참이라 이걸 못 가른다.
	test("③ glyphs JetBrains Mono lacks do not pull in D2Coding", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			writeFileSync(
				join(repoDir, "src", "hello.ts"),
				'export const hello = (): string => "hello, world"; // ──── box\n',
			);
			await page.goto(url);
			await expect(
				page.locator("diffs-container [data-line]").filter({ hasText: "────" }),
			).toBeVisible();
			await page.evaluate(() => document.fonts.ready);
			// 로드가 시작될 틈을 준다 — 범위가 없으면 여기서 loading/loaded가 된다.
			await page.waitForTimeout(500);
			expect(await statusOf(page, "D2Coding")).toEqual(["unloaded"]);
		} finally {
			await stop();
		}
	});
});
