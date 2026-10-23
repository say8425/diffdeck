import type { Page } from "@playwright/test";
import {
	expect,
	launchViewer,
	test,
	waitForStableHeight,
	waitForStableScrollTop,
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

const chromeStyle = (page: Page, selector: string): Promise<string> =>
	page.evaluate((sel) => {
		for (const c of document.querySelectorAll("diffs-container")) {
			const el = c.shadowRoot?.querySelector(sel);
			if (el) {
				const s = getComputedStyle(el);
				return `${s.fontSize}/${s.lineHeight}`;
			}
		}
		return "";
	}, selector);

// 엔진의 앵커와 같은 기준이다: sticky 헤더 아래에서 처음 온전히 보이는 줄.
// 픽스처의 옛·새 줄은 내용이 서로 달라 텍스트로 줄을 가린다.
const anchorLine = (page: Page): Promise<string> =>
	page.evaluate(() => {
		const scrollerTop = document
			.getElementById("diff")!
			.getBoundingClientRect().top;
		for (const c of document.querySelectorAll("diffs-container")) {
			const root = c.shadowRoot;
			if (!root) continue;
			const header = root.querySelector("[data-diffs-header]");
			const floor = Math.max(
				scrollerTop,
				header?.getBoundingClientRect().bottom ?? scrollerTop,
			);
			for (const row of root.querySelectorAll("[data-line]")) {
				if (row.getBoundingClientRect().top >= floor - 0.5) {
					return row.textContent ?? "";
				}
			}
		}
		return "";
	});

// 렌더 윈도우 밖이면 NaN이라 어떤 단언도 통과하지 못한다.
const lineOffset = (page: Page, text: string): Promise<number> =>
	page.evaluate((t) => {
		const scrollerTop = document
			.getElementById("diff")!
			.getBoundingClientRect().top;
		for (const c of document.querySelectorAll("diffs-container")) {
			for (const row of c.shadowRoot?.querySelectorAll("[data-line]") ?? []) {
				if (row.textContent === t) {
					return Math.round(row.getBoundingClientRect().top - scrollerTop);
				}
			}
		}
		return Number.NaN;
	}, text);

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
	await expect
		.poll(() => chromeStyle(page, "[data-diffs-header]"))
		.toBe("13px/20px");
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

test("hunk separators keep their size", async ({ page }) => {
	const viewer = await launchViewer([], { longFileSmallEdit: true });
	try {
		await page.addInitScript(
			(k) => localStorage.setItem(k, "1.5"),
			FONT_SCALE_KEY,
		);
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect.poll(() => codeLineStyle(page)).toBe("19.5px/30px");
		await expect
			.poll(() => chromeStyle(page, "[data-separator]"))
			.toBe("13px/20px");
	} finally {
		await viewer.stop();
	}
});

test("keyboard focus stays in the menu when the pressed button disables itself", async ({
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

	await page.locator("#font-scale-inc").focus();
	await page.keyboard.press("Enter");
	await expect(page.locator("#font-scale-inc")).toBeDisabled();
	await expect(page.locator("#font-scale-dec")).toBeFocused();

	await page.locator("#font-scale-reset").focus();
	await page.keyboard.press("Enter");
	await expect(page.locator("#font-scale-reset")).toBeDisabled();
	await expect(page.locator("#font-scale-inc")).toBeFocused();
	await expect(page.locator("#font-scale-status")).toHaveText("Font size 100%");
});

// 배율 변경은 뷰어에서 가장 큰 레이아웃 변화다. setOptions가 엔진의 의미론적
// 앵커를 잡아야 읽던 줄이 화면의 같은 자리에 남는다(viewer.md "CodeView 수명과 스크롤").
test("changing the scale keeps the anchored line in place", async ({
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

		const box = await scroller.boundingBox();
		if (!box) throw new Error("#diff has no bounding box");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.wheel(0, 20_000);
		await waitForStableScrollTop(scroller);
		const anchor = await anchorLine(page);
		expect(anchor).not.toBe("");
		const offset = await lineOffset(page, anchor);

		await openMenu(page);
		for (let i = 0; i < 5; i++) await page.locator("#font-scale-inc").click();
		await expect(page.locator("#font-scale-value")).toHaveText("×1.5");
		await waitForStableHeight(scroller);
		await waitForStableScrollTop(scroller);

		expect(await lineOffset(page, anchor)).toBe(offset);
	} finally {
		await viewer.stop();
	}
});
