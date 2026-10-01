import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";

// 트리의 이름은 middle-truncation으로 여러 노드에 쪼개져 텍스트로는 못 찾는다.
const treeHasPath = (page: Page, path: string): Promise<boolean> =>
	page
		.locator("file-tree-container")
		.evaluate(
			(el, p) =>
				el.shadowRoot?.querySelector(`[data-item-path="${p}"]`) != null,
			path,
		);

// `#empty`가 거쳐 간 문구를 첫 페인트 전부터 기록한다 — 깜박임은 최종 상태로는
// 안 보인다.
const recordEmptyTexts = async (page: Page): Promise<void> => {
	await page.addInitScript(() => {
		const seen: string[] = [];
		(window as unknown as { __emptyTexts: string[] }).__emptyTexts = seen;
		const push = (): void => {
			const el = document.getElementById("empty");
			const text = el ? (el.textContent ?? "") : "";
			if (text !== "" && seen[seen.length - 1] !== text) seen.push(text);
		};
		// document-start에는 `documentElement`가 없을 수 있어 `document`를 관찰한다.
		new MutationObserver(push).observe(document, {
			childList: true,
			subtree: true,
			characterData: true,
		});
		document.addEventListener("DOMContentLoaded", push);
	});
};

const emptyTexts = (page: Page): Promise<string[]> =>
	page.evaluate(
		() => (window as unknown as { __emptyTexts: string[] }).__emptyTexts,
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
			// untracked가 숨겨져 있을 뿐이라 "Working tree clean"이라고 하지 않는다.
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
			await expect(
				card.locator("button.empty-action", { hasText: "untracked" }),
			).toHaveText("1 untracked file(s) hidden — show");

			// 피커 라벨은 head를 말하므로 base 전환의 증거가 못 된다 — 카드가
			// 사라지고 개수가 뜨는 것으로 본다.
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
			// 픽스처의 untracked data.txt까지 지워 완전 무변경으로 만든다.
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

			// untracked 개수는 지문 밖이라 새 untracked 파일에도 304가 오지만 카드는
			// 다시 계산돼야 한다. head를 바꾸기 전에 본다 — 커밋된 rev에서는
			// untracked를 재지 않아 이 안내가 없다.
			writeFileSync(join(repoDir, "late.txt"), "new untracked\n");
			await page.evaluate(() => window.dispatchEvent(new Event("focus")));
			await expect(
				page.locator("#empty.empty-card button.empty-action", {
					hasText: "untracked",
				}),
			).toHaveText("1 untracked file(s) hidden — show");

			// 빈 diff의 etag는 선택과 무관해서, 선택을 바꿔도 304로 옛 카드에 고착될
			// 수 있다(viewer.md "갱신과 캐시"). 컨텍스트 줄이 새 head를 말하는지 본다.
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

	test("nothing at all in the working view: opens the base diff instead", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([], {
			clean: true,
			featureBranchCommit: true,
		});
		try {
			// data.txt가 남아 있으면 (토글 뒤에) 볼 것이 있어 자동 전환이 억제된다.
			rmSync(join(repoDir, "data.txt"));
			await page.goto(url);

			await expect(page.locator("#status")).toHaveText("1 file(s)");
			await expect(page.locator("#empty")).toHaveCount(0);

			// 자동 전환은 저장하지 않는다 — 저장하면 이후 자동 전환이 영구히 막힌다.
			const saved = await page.evaluate(() =>
				Object.keys(localStorage).filter((k) => k.includes("compare-base")),
			);
			expect(saved).toEqual([]);
		} finally {
			await stop();
		}
	});

	test("an explicit base choice is never overridden", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([], {
			clean: true,
			featureBranchCommit: true,
		});
		try {
			rmSync(join(repoDir, "data.txt"));
			await page.goto(`${url}&base=HEAD`);

			// 자동 전환이 걸렸다면 diff가 렌더되어 카드가 사라진다.
			await expect(page.locator("#empty.empty-card")).toBeVisible();
		} finally {
			await stop();
		}
	});

	test("never says No changes before the card is ready", async ({ page }) => {
		const { url, stop } = await launchViewer([], {
			clean: true,
			featureBranchCommit: true,
		});
		try {
			await recordEmptyTexts(page);
			await page.goto(url);
			await expect(
				page.locator("#empty.empty-card .empty-headline"),
			).toHaveText("No tracked changes");

			const texts = await emptyTexts(page);
			expect(texts).not.toContain("No changes.");
			expect(texts[0]).toContain("Loading diff…");
		} finally {
			await stop();
		}
	});

	test("the auto base switch shows no interim No changes", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([], {
			clean: true,
			featureBranchCommit: true,
		});
		try {
			rmSync(join(repoDir, "data.txt"));
			await recordEmptyTexts(page);
			await page.goto(url);
			await expect(page.locator("#status")).toHaveText("1 file(s)");

			expect(await emptyTexts(page)).not.toContain("No changes.");
		} finally {
			await stop();
		}
	});

	test("falls back to the bare line when the summary is unreachable", async ({
		page,
	}) => {
		const { url, stop } = await launchViewer([], {
			clean: true,
			featureBranchCommit: true,
		});
		try {
			await page.route("**/api/summary*", (route) => route.abort());
			await page.goto(url);
			await expect(page.locator("#empty")).toHaveText("No changes.");
			// 폴백은 로딩 표시를 걷어낸다 — 스피너가 남으면 영원히 로딩이다.
			await expect(page.locator("#empty")).not.toHaveAttribute("data-loading");
		} finally {
			await stop();
		}
	});
});
