// 정보형 빈 상태 카드: diff가 0건일 때 "No changes." 대신 브랜치/베이스
// 컨텍스트와 실개수 기반 액션(모드 전환·untracked 표시)을 보여준다
// (browser/emptyState.ts + /api/summary). mode 드롭다운을 실제로 조작하는
// 최초의 e2e이기도 하다.
//
// 트리 존재 확인은 render.e2e.ts와 같은 이유로 shadow root의
// `data-item-path` 속성을 직접 본다 (트리 텍스트는 middle-truncation 때문에
// 로케이터 텍스트 매칭이 불안정).
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const treeHasPath = (page: Page, path: string): Promise<boolean> =>
	page
		.locator("file-tree-container")
		.evaluate(
			(el, p) =>
				el.shadowRoot?.querySelector(`[data-item-path="${p}"]`) != null,
			path,
		);

test.describe("informative empty state", () => {
	test("clean feature branch: card explains where the changes are", async ({
		page,
	}) => {
		const { url, stop } = await launchViewer([], {
			clean: true,
			featureBranchCommit: true,
		});
		try {
			await page.goto(url);
			const card = page.locator("#empty.empty-card");
			await expect(card).toBeVisible();
			await expect(card.locator(".empty-headline")).toHaveText(
				"Working tree clean",
			);
			await expect(card.locator(".empty-context")).toHaveText(
				"on feature · 1 commit(s) ahead of main",
			);
			const switchBtn = card.locator("button.empty-action", {
				hasText: "changed vs main",
			});
			await expect(switchBtn).toHaveText("1 file(s) changed vs main — view");
			// 픽스처가 항상 남기는 untracked data.txt도 안내되어야 한다.
			await expect(
				card.locator("button.empty-action", { hasText: "untracked" }),
			).toHaveText("1 untracked file(s) hidden — show");

			// 클릭 → 드롭다운이 base로 바뀌고 커밋된 diff가 렌더된다.
			await switchBtn.click();
			await expect(page.locator("#diff-mode")).toHaveValue("base");
			await expect(page.locator("#empty")).toHaveCount(0);
			await expect(page.locator("#status")).toHaveText("1 file(s)");
			await expect.poll(() => treeHasPath(page, "src/hello.ts")).toBe(true);
		} finally {
			await stop();
		}
	});

	test("hidden untracked file: show action reveals it", async ({ page }) => {
		const { url, stop } = await launchViewer([], { clean: true });
		try {
			await page.goto(url);
			const card = page.locator("#empty.empty-card");
			await expect(card).toBeVisible();
			await card
				.locator("button.empty-action", { hasText: "untracked" })
				.click();
			await expect(page.locator("#toggle-untracked")).toBeChecked();
			await expect(page.locator("#empty")).toHaveCount(0);
			await expect.poll(() => treeHasPath(page, "data.txt")).toBe(true);
		} finally {
			await stop();
		}
	});

	test("all quiet: card says the branch matches the base", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([], { clean: true });
		try {
			// 픽스처가 항상 남기는 untracked data.txt를 지워 완전 무변경 상태로.
			rmSync(join(repoDir, "data.txt"));
			await page.goto(url);
			const card = page.locator("#empty.empty-card");
			await expect(card.locator(".empty-quiet")).toHaveText(
				"Branch matches main — nothing to show in any mode",
			);
			await expect(card.locator(".empty-context")).toHaveText("on main");
			await expect(card.locator("button.empty-action")).toHaveCount(0);
		} finally {
			await stop();
		}
	});
});
