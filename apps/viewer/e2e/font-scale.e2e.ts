import type { Page } from "@playwright/test";
import {
	expect,
	launchViewer,
	test,
	waitForStableHeight,
} from "./fixtures/app.ts";

const FONT_SCALE_KEY = "diffdeck:font-scale";

const codeLineStyle = (page: Page): Promise<string> =>
	page.evaluate(() => {
		for (const c of document.querySelectorAll("diffs-container")) {
			const line = c.shadowRoot?.querySelector("[data-line]");
			if (line) {
				const s = getComputedStyle(line);
				return `${s.fontSize}/${s.lineHeight}`;
			}
		}
		return "";
	});

const headerStyle = (page: Page): Promise<string> =>
	page.evaluate(() => {
		for (const c of document.querySelectorAll("diffs-container")) {
			const header = c.shadowRoot?.querySelector("[data-diffs-header]");
			if (header) {
				const s = getComputedStyle(header);
				return `${s.fontSize}/${s.lineHeight}`;
			}
		}
		return "";
	});

const openMenu = async (page: Page): Promise<void> => {
	await page.locator("#overflow-btn").click();
	await expect(page.locator("#overflow-menu")).toBeVisible();
};

test("the menu buttons scale the code, keep the header, and persist", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect.poll(() => codeLineStyle(page)).toBe("13px/20px");

	await openMenu(page);
	await expect(page.locator("#font-scale-value")).toHaveText("×1");
	await expect(page.locator("#font-scale-reset")).toBeDisabled();

	await page.locator("#font-scale-inc").click();
	await page.locator("#font-scale-inc").click();
	await expect(page.locator("#font-scale-value")).toHaveText("×1.2");
	// 메뉴는 열린 채라 이어서 누를 수 있다.
	await expect(page.locator("#overflow-menu")).toBeVisible();
	await expect.poll(() => codeLineStyle(page)).toBe("15.6px/24px");
	await expect.poll(() => headerStyle(page)).toBe("13px/20px");
	expect(
		await page.evaluate((k) => localStorage.getItem(k), FONT_SCALE_KEY),
	).toBe("1.2");

	await page.reload();
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect.poll(() => codeLineStyle(page)).toBe("15.6px/24px");
	await openMenu(page);
	await expect(page.locator("#font-scale-value")).toHaveText("×1.2");

	await page.locator("#font-scale-dec").click();
	await expect(page.locator("#font-scale-value")).toHaveText("×1.1");
	await expect.poll(() => codeLineStyle(page)).toBe("14.3px/22px");

	await page.locator("#font-scale-reset").click();
	await expect(page.locator("#font-scale-value")).toHaveText("×1");
	await expect(page.locator("#font-scale-reset")).toBeDisabled();
	await expect.poll(() => codeLineStyle(page)).toBe("13px/20px");
	expect(
		await page.evaluate((k) => localStorage.getItem(k), FONT_SCALE_KEY),
	).toBe("1");
});

test("the end buttons disable at the range limits", async ({
	page,
	viewerUrl,
}) => {
	await page.addInitScript((k) => {
		if (!sessionStorage.getItem("seeded")) {
			sessionStorage.setItem("seeded", "1");
			localStorage.setItem(k, "1.9");
		}
	}, FONT_SCALE_KEY);
	await page.goto(viewerUrl);
	await openMenu(page);
	await expect(page.locator("#font-scale-inc")).toBeEnabled();
	await page.locator("#font-scale-inc").click();
	await expect(page.locator("#font-scale-value")).toHaveText("×2");
	await expect(page.locator("#font-scale-inc")).toBeDisabled();

	await page.evaluate((k) => localStorage.setItem(k, "0.9"), FONT_SCALE_KEY);
	await page.reload();
	await openMenu(page);
	await expect(page.locator("#font-scale-dec")).toBeEnabled();
	await page.locator("#font-scale-dec").click();
	await expect(page.locator("#font-scale-value")).toHaveText("×0.8");
	await expect(page.locator("#font-scale-dec")).toBeDisabled();
	await expect(page.locator("#font-scale-inc")).toBeEnabled();
});

// 가상화는 아직 그리지 않은 파일의 높이를 itemMetrics.lineHeight로 추정한다.
// 그 값이 글자 크기를 따라가지 않으면 화면 밖 파일들이 옛 줄 높이로 남아
// 스크롤 높이가 거의 그대로다. 파일마다 줄이 수백 개라 헤더·구분선 같은 고정
// 높이를 빼도 비율이 2에 가깝다.
test("doubling the scale doubles the estimated scroll height", async ({
	page,
}) => {
	const viewer = await launchViewer([], { bulkFiles: 12 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		const scroller = page.locator("#diff");
		await waitForStableHeight(scroller);
		const before = await scroller.evaluate((el) => el.scrollHeight);

		await openMenu(page);
		for (let i = 0; i < 10; i++) await page.locator("#font-scale-inc").click();
		await expect(page.locator("#font-scale-value")).toHaveText("×2");
		await waitForStableHeight(scroller);
		const after = await scroller.evaluate((el) => el.scrollHeight);

		expect(after / before).toBeGreaterThan(1.9);
		expect(after / before).toBeLessThan(2.05);
	} finally {
		await viewer.stop();
	}
});
