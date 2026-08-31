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

			// 클릭 → base가 자동 해석으로 바뀌고 커밋된 diff가 렌더된다.
			// 피커 라벨은 이제 head를 말하므로 base의 증거가 아니다 — 관찰
			// 가능한 신호는 카드가 사라지고 개수가 나타나는 것이다.
			await switchBtn.click();
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
		const { url, repoDir, stop } = await launchViewer([], {
			clean: true,
			branches: ["develop"],
		});
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

			// 회귀: 304(unchanged) 응답이라도 빈 상태가 유지되는 동안엔 카드를
			// 재계산해야 한다 — untracked 개수는 지문 밖 사실이라, 새 untracked
			// 파일이 생겨도 diff 지문은 그대로(untracked=0은 -uno)여서 304가
			// 온다. focus 리프레시 후 카드에 안내가 나타나야 한다.
			//
			// **head를 바꾸기 전에** 확인한다 — 커밋된 rev를 보고 있으면
			// untracked는 재지 않은 값(null)이라 이 안내가 원리적으로 없다.
			writeFileSync(join(repoDir, "late.txt"), "new untracked\n");
			await page.evaluate(() => window.dispatchEvent(new Event("focus")));
			await expect(
				page.locator("#empty.empty-card button.empty-action", {
					hasText: "untracked",
				}),
			).toHaveText("1 untracked file(s) hidden — show");

			// 회귀: 양쪽이 다 빈 상태에서 선택을 바꿔도 카드가 새 사실로
			// 갱신되어야 한다 — 빈 payload의 etag가 선택과 무관하게 같아 304로
			// 이전 카드에 고착되던 버그의 가드 (선택 변경 시 lastEtag 리셋).
			// head를 바꾸면 요약의 branch가 **보고 있는 그 브랜치**를 말하므로
			// 카드의 컨텍스트 줄이 그 증거다.
			await page.locator("#ref-picker-btn").click();
			await page
				.locator("#ref-picker .ref-row")
				.filter({ hasText: /^develop/ })
				.first()
				.click();
			await expect(page.locator("#empty.empty-card .empty-context")).toHaveText(
				"on develop",
			);
		} finally {
			await stop();
		}
	});

	// 워크트리 워크플로에서는 작업이 브랜치에 **커밋**돼 있어 기본 뷰(미커밋
	// 변경)가 구조적으로 비어 있다. 워크트리를 팔 때마다 "볼 게 가장 많은
	// 순간에 빈 화면"을 만나고 카드의 버튼을 한 번씩 눌러 줘야 했다 — 고른
	// 적이 없다면 볼 것이 있는 쪽을 바로 연다.
	test("nothing at all in the working view: opens the base diff instead", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([], {
			clean: true,
			featureBranchCommit: true,
		});
		try {
			// 픽스처의 untracked 스크래치를 지운다 — 그게 남아 있으면 이 뷰에도
			// (토글 뒤에) 볼 것이 있으므로 자동 전환이 의도적으로 억제된다.
			rmSync(join(repoDir, "data.txt"));
			await page.goto(url);

			await expect(page.locator("#status")).toHaveText("1 file(s)");
			await expect(page.locator("#empty")).toHaveCount(0);

			// **저장하지 않는다** — 추론이지 사용자의 선택이 아니다. 저장해 버리면
			// 고른 적 없는 프리퍼런스가 생겨 이후 판단이 영영 막힌다.
			const saved = await page.evaluate(() =>
				Object.keys(localStorage).filter((k) => k.includes("compare-base")),
			);
			expect(saved).toEqual([]);
		} finally {
			await stop();
		}
	});

	// 자동 전환이 사용자의 선택을 덮으면 안 된다. URL의 `base=`는 명시적
	// 선택이므로 워킹트리가 텅 비어도 그대로 둔다.
	test("an explicit base choice is never overridden", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([], {
			clean: true,
			featureBranchCommit: true,
		});
		try {
			rmSync(join(repoDir, "data.txt"));
			await page.goto(`${url}&base=HEAD`);

			// 카드가 그대로 떠 있다는 것이 "덮지 않았다"의 증거다 — 자동 전환이
			// 걸렸다면 diff가 렌더되어 카드가 사라진다.
			await expect(page.locator("#empty.empty-card")).toBeVisible();
		} finally {
			await stop();
		}
	});
});
