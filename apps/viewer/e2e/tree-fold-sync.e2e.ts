// 사이드바 트리 접기 → diff fold 자동 동기화("Fold with tree"). 오버플로 메뉴의
// `#toggle-fold-with-tree` 체크박스로 켜면, 사이드바에서 디렉토리를 접었을 때
// 그 아래 diff 파일들이 기존 헤더 폴드와 동일하게(header-only) 접힌다. 다른
// 디렉토리(루트의 README.md)는 영향받지 않는지 함께 검증한다.
//
// 기본 픽스처(src/hello.ts 하나)만 쓴다: bulkFiles 옵션으로 만드는 200줄짜리
// 파일은 CodeView 가상화를 트리거해(각 파일 수천 px) hello.ts/README.md가
// 초기 뷰포트 밖으로 밀려나 마운트되지 않는 문제가 실측으로 확인됐다(같은
// 파일에 대한 hasCode 폴이 타임아웃) — 짧은 기본 픽스처로는 재현되지 않는다.
// 대신 하나의 파일에 대해 (a) 트리 유래 접힘이 토글 off에 해제되는지, (b)
// 그 뒤 개별 헤더 클릭으로 다시 수동 접으면 토글 off에도 유지되는지를 순서대로
// 검증해 "토글 off는 트리 유래 접힘만 지운다"는 속성을 파일 하나로 커버한다.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/app.ts";

const hasCode = (page: Page, fileId: string): Promise<boolean> =>
	page
		.locator("diffs-container")
		.filter({ has: page.locator(`[data-fold="${fileId}"]`) })
		.evaluate((el) => el.shadowRoot?.querySelector("pre") != null);

test("collapsing a directory folds its diff file; individual overrides persist; toggling off restores only tree-driven folds", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);
	expect(await hasCode(page, "README.md")).toBe(true);

	// Turn "Fold with tree" on via the overflow menu. The menu stays open
	// after a checkbox change (so several toggles can be flipped in a row);
	// close it explicitly so every subsequent `#overflow-btn` click reliably
	// opens it rather than toggling it shut.
	await page.locator("#overflow-btn").click();
	await page.locator("#toggle-fold-with-tree").check();
	await page.keyboard.press("Escape");

	const srcRow = page
		.locator("file-tree-container")
		.locator('[data-item-path="src/"]');

	// Collapse `src` in the sidebar tree.
	await srcRow.click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);
	await expect(page.locator('[data-fold="src/hello.ts"]')).toHaveAttribute(
		"aria-label",
		"Expand file",
	);
	// A sibling top-level file is untouched.
	expect(await hasCode(page, "README.md")).toBe(true);

	// Toggling the sync off restores the tree-driven fold (nothing was
	// manually overridden yet).
	await page.locator("#overflow-btn").click();
	await page.locator("#toggle-fold-with-tree").uncheck();
	await page.keyboard.press("Escape");
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);

	// Turn it back on; `src` is still collapsed in the tree, so hello.ts
	// re-folds immediately.
	await page.locator("#overflow-btn").click();
	await page.locator("#toggle-fold-with-tree").check();
	await page.keyboard.press("Escape");
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);

	// Individually expand it via the header — it must stay expanded even
	// though `src` remains collapsed in the tree.
	await page.locator('[data-fold="src/hello.ts"]').click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(true);
	await expect(page.locator('[data-fold="src/hello.ts"]')).toHaveAttribute(
		"aria-label",
		"Collapse file",
	);

	// Now manually re-collapse it via the header — this is a manual fold
	// (collapsedIds), distinct from the earlier tree-driven one.
	await page.locator('[data-fold="src/hello.ts"]').click();
	await expect.poll(() => hasCode(page, "src/hello.ts")).toBe(false);

	// Toggling the sync off must NOT restore this file — the manual fold
	// persists regardless of the toggle.
	await page.locator("#overflow-btn").click();
	await page.locator("#toggle-fold-with-tree").uncheck();
	expect(await hasCode(page, "src/hello.ts")).toBe(false);
});
