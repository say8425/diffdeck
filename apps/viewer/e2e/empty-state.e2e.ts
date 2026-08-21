// 정보형 빈 상태 카드: diff가 0건일 때 "No changes." 대신 브랜치/베이스
// 컨텍스트와 실개수 기반 액션(모드 전환·untracked 표시)을 보여준다
// (browser/emptyState.ts + /api/summary). mode 드롭다운을 실제로 조작하는
// 최초의 e2e이기도 하다.
//
// 트리 존재 확인은 render.e2e.ts와 같은 이유로 shadow root의
// `data-item-path` 속성을 직접 본다 (트리 텍스트는 middle-truncation 때문에
// 로케이터 텍스트 매칭이 불안정).
import { rmSync, writeFileSync } from "node:fs";
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
			// untracked data.txt가 숨겨져 있으므로 "Working tree clean"이 아니라
			// 측정한 것만 주장하는 헤드라인이어야 한다.
			await expect(card.locator(".empty-headline")).toHaveText(
				"No tracked changes",
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

			// 클릭 → 피커가 자동 해석 base로 바뀌고 커밋된 diff가 렌더된다.
			await switchBtn.click();
			await expect(page.locator("#ref-picker-label")).toHaveText("vs main");
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

	test("all quiet: card says nothing to show in any mode", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([], { clean: true });
		try {
			// 픽스처가 항상 남기는 untracked data.txt를 지워 완전 무변경 상태로.
			rmSync(join(repoDir, "data.txt"));
			await page.goto(url);
			const card = page.locator("#empty.empty-card");
			await expect(card.locator(".empty-headline")).toHaveText(
				"Working tree clean",
			);
			await expect(card.locator(".empty-quiet")).toHaveText(
				"Nothing to show in any mode",
			);
			await expect(card.locator(".empty-context")).toHaveText("on main");
			await expect(card.locator("button.empty-action")).toHaveCount(0);

			// 회귀: 양쪽이 다 빈 상태에서 기준을 바꿔도 카드가 새 문구로
			// 갱신되어야 한다 — 빈 payload의 etag가 기준과 무관하게 같아 304로
			// 이전 카드에 고착되던 버그의 가드 (선택 변경 시 lastEtag 리셋).
			await page.locator("#ref-picker-btn").click();
			await page
				.locator("#ref-picker .ref-row")
				.filter({ hasText: /^main/ })
				.first()
				.click();
			await expect(
				page.locator("#empty.empty-card .empty-headline"),
			).toHaveText("No changes vs main");

			// 회귀: 304(unchanged) 응답이라도 빈 상태가 유지되는 동안엔 카드를
			// 재계산해야 한다 — untracked 개수는 지문 밖 사실이라, 새 untracked
			// 파일이 생겨도 diff 지문은 그대로(untracked=0은 -uno)여서 304가
			// 온다. focus 리프레시 후 카드에 안내가 나타나야 한다.
			writeFileSync(join(repoDir, "late.txt"), "new untracked\n");
			await page.evaluate(() => window.dispatchEvent(new Event("focus")));
			await expect(
				page.locator("#empty.empty-card button.empty-action", {
					hasText: "untracked",
				}),
			).toHaveText("1 untracked file(s) hidden — show");
		} finally {
			await stop();
		}
	});
});
