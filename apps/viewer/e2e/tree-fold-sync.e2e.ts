// 기본 픽스처를 쓴다 — bulkFiles를 더하면 hello.ts·README.md가 가상화로 초기
// 뷰포트 밖에 밀려 마운트되지 않는다. 그래서 파일 하나로 (a) 트리 유래 접힘은
// 토글 off에 풀리고 (b) 수동 접힘은 남는 것을 순서대로 본다.
import { expect, hasCode, test } from "./fixtures/app.ts";

test("collapsing a directory folds its diff file; individual overrides persist; toggling off restores only tree-driven folds", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);
	expect(await hasCode(page, "README.md")).toBe(true);

	// The menu stays open after a checkbox change; close it so the next
	// #overflow-btn click opens it rather than shutting it.
	await page.locator("#overflow-btn").click();
	await page.locator("#toggle-fold-with-tree").check();
	await page.keyboard.press("Escape");

	const srcRow = page
		.locator("file-tree-container")
		.locator('[data-item-path="src/"]');

	await srcRow.click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);
	await expect(page.locator('[data-fold="src/hello.ts"]')).toHaveAttribute(
		"aria-label",
		"Expand file",
	);
	expect(await hasCode(page, "README.md")).toBe(true);

	await page.locator("#overflow-btn").click();
	await page.locator("#toggle-fold-with-tree").uncheck();
	await page.keyboard.press("Escape");
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);

	await page.locator("#overflow-btn").click();
	await page.locator("#toggle-fold-with-tree").check();
	await page.keyboard.press("Escape");
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);

	await page.locator('[data-fold="src/hello.ts"]').click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);
	await expect(page.locator('[data-fold="src/hello.ts"]')).toHaveAttribute(
		"aria-label",
		"Collapse file",
	);

	// 헤더로 다시 접은 것은 수동 접힘이라 토글을 꺼도 남아야 한다.
	await page.locator('[data-fold="src/hello.ts"]').click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);

	await page.locator("#overflow-btn").click();
	await page.locator("#toggle-fold-with-tree").uncheck();
	expect(await hasCode(page, "src/hello.ts")).toBe(false);
});
