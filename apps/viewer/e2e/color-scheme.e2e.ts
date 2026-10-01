// 색 구성표 — 뷰어는 다크 전용이다.
//
// 두 vendored 엔진은 `:host { color-scheme: light dark }`와 `light-dark()`로 색을
// 고른다. diff 엔진은 `themeType: "dark"`로 다크가 고정되지만 파일 트리에는 그런
// 전용 옵션이 없어서, host에 색 구성표를 직접 걸지 않으면 OS가 라이트 모드일 때
// 사이드바만 하얗게(`#f8f8f8`) 그려졌다. happy-dom에는 계산된 색 구성표가 없어
// 유닛이 원리적으로 못 보는 계약이라, 실브라우저에서 라이트 모드를 흉내 낸다
// (Playwright의 기본값도 라이트지만, 이 스펙의 전제이므로 명시한다).
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

	// 페이지가 다크를 선언해야 스크롤바·캐럿 같은 UA 기본값도 다크로 그려진다.
	expect(
		await page.evaluate(
			() => getComputedStyle(document.documentElement).colorScheme,
		),
	).toBe("dark");
	// 트리 자신의 `:host` 선언(light dark)을 바깥 문서의 규칙이 덮어야 한다.
	// :root의 선언은 상속될 뿐이라 host에 직접 걸린 :host 선언을 이기지 못한다.
	await expect(host).toHaveCSS("color-scheme", "dark");
	// 선언이 아니라 결과를 본다 — light-dark()가 실제로 다크 값으로 풀렸는가.
	// 사이드바는 페이지와 같은 색이어야 한다.
	const pageBg = await page.evaluate(
		() => getComputedStyle(document.body).backgroundColor,
	);
	await expect(host).toHaveCSS("background-color", pageBg);
	await expect(
		page.locator("file-tree-container [data-file-tree-search-input]"),
	).toHaveCSS("background-color", "rgb(7, 7, 7)");
	// diff 쪽 다크는 엔진의 `themeType: "dark"` 한 줄에 달려 있다 — 같이 지킨다.
	await expect(page.locator("diffs-container").first()).toHaveCSS(
		"color-scheme",
		"dark",
	);
});
