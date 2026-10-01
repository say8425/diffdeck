// 뷰어는 다크 전용이다(viewer.md). happy-dom에는 계산된 색 구성표가 없어
// 실브라우저에서 OS 라이트 모드를 흉내 낸다.
import { expect, test } from "./fixtures/app.ts";

test.use({ colorScheme: "light" });

test("OS가 라이트 모드여도 파일 트리·diff·페이지는 다크로 그려진다", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	const host = page.locator("file-tree-container");
	await expect(host).toBeVisible();

	expect(
		await page.evaluate(
			() => getComputedStyle(document.documentElement).colorScheme,
		),
	).toBe("dark");
	await expect(host).toHaveCSS("color-scheme", "dark");
	// 선언이 아니라 light-dark()가 실제로 다크 값으로 풀렸는지 본다.
	const pageBg = await page.evaluate(
		() => getComputedStyle(document.body).backgroundColor,
	);
	await expect(host).toHaveCSS("background-color", pageBg);
	await expect(
		page.locator("file-tree-container [data-file-tree-search-input]"),
	).toHaveCSS("background-color", "rgb(7, 7, 7)");
	// diff 쪽 다크는 엔진의 `themeType: "dark"` 한 줄에 달려 있다.
	await expect(page.locator("diffs-container").first()).toHaveCSS(
		"color-scheme",
		"dark",
	);
});
