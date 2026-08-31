// 툴바 피커: **무엇을 볼 것인가(head)**를 고른다.
//
// 예전에는 "무엇과 견줄까(base)"를 골랐는데, 목록의 브랜치 이름이 "그 브랜치를
// 보여줘"로 읽히면서 실제로는 반대 축을 건드리는 어긋남이 있었다 — 메인
// 워크트리에서 남의 브랜치를 골라도 1 file만 나오던 것이 그 결과다.
//
// 여기서만 잡히는 계약들이다 — happy-dom에는 레이아웃도 CSS 캐스케이드도
// 없어서 "[hidden]이 실제로 숨기는가", "패널이 정말 페인트되는가",
// "닫을 때 포커스가 트리거로 돌아오는가"를 유닛이 원리적으로 볼 수 없다.
// 그리고 배선(고른 행이 실제로 무엇을 하는가)은 main.ts가 커버리지 게이트
// 밖이라 여기가 유일한 그물이다.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const OPTS = { featureBranchCommit: true, branches: ["develop"] };

/**
 * 픽스처에는 원격이 없어 원격 HEAD symref가 비고, 그러면 서버가 default
 * 브랜치를 해석하지 못한다(`/api/refs`의 defaultBranch가 null). 자기 자신을
 * origin으로 걸어 그 symref를 세운다 — default 정렬을 보려면 이것이 있어야 한다.
 */
const giveItADefaultBranch = (dir: string): void => {
	// **`git remote add`를 쓰지 마라.** 원격 URL이 생기면 base 해석의 첫 단계인
	// `gh pr view`가 그것을 GitHub 리포로 풀어 보려 하고, 그때부터 스펙 하나가
	// 수십 초씩 걸린다(실측: 이 파일 전체가 16초에서 15분으로 늘었다).
	// 필요한 것은 symref 하나뿐이므로 참조만 직접 세운다.
	const sha = spawnSync("git", ["-C", dir, "rev-parse", "main"], {
		encoding: "utf8",
	}).stdout.trim();
	run(dir, ["update-ref", "refs/remotes/origin/main", sha]);
	run(dir, [
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
		"refs/remotes/origin/main",
	]);
};

const run = (dir: string, args: string[]): void => {
	const r = spawnSync("git", ["-C", dir, ...args], { stdio: "pipe" });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${r.stderr?.toString()}`);
	}
};

test.describe("head picker", () => {
	test("opens to a searchable list and closes on Escape", async ({ page }) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			const panel = page.locator("#ref-picker");
			// author가 display를 선언한 노드라 [hidden] 짝이 없으면 처음부터
			// 열린 채로 보인다 — 이 단언이 그 규칙의 회귀망이다.
			await expect(panel).toBeHidden();

			await page.locator("#ref-picker-btn").click();
			await expect(panel).toBeVisible();
			await expect(page.locator("#ref-picker-btn")).toHaveAttribute(
				"aria-expanded",
				"true",
			);

			await page.keyboard.press("Escape");
			await expect(panel).toBeHidden();
			await expect(page.locator("#ref-picker-btn")).toBeFocused();
		} finally {
			await stop();
		}
	});

	test("filters the list as you type", async ({ page }) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			await page.locator("#ref-picker-btn").click();
			const rows = page.locator("#ref-picker .ref-row");
			await expect(rows.filter({ hasText: "develop" })).toHaveCount(1);
			expect(await rows.count()).toBeGreaterThan(1);

			await page.locator("#ref-picker-search").fill("develop");
			await expect(rows).toHaveCount(1);
			await expect(rows.first()).toHaveText(/develop/);
		} finally {
			await stop();
		}
	});

	// 워크트리가 하나뿐이면 고를 것이 없다. 제목만 남기고 목록을 비우면
	// "뭔가 있어야 하는데 없다"로 읽히므로 구역 자체가 사라진다.
	test("hides the worktree section when there is nothing to choose", async ({
		page,
	}) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			await page.locator("#ref-picker-btn").click();
			await expect(page.locator("#ref-picker .ref-section")).toHaveText([
				"BRANCHES",
			]);
		} finally {
			await stop();
		}
	});

	// 워크트리가 둘 이상이면 구역이 서고, 각 행이 **물고 있는 브랜치**를 말한다.
	test("lists worktrees with the branch each one holds", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([], OPTS);
		try {
			const nested = join(repoDir, ".claude", "worktrees", "side");
			run(repoDir, ["worktree", "add", "-q", "-b", "side/work", nested]);

			await page.goto(url);
			await page.locator("#ref-picker-btn").click();
			await expect(page.locator("#ref-picker .ref-section")).toHaveText([
				"WORKTREES",
				"BRANCHES",
			]);

			const rows = page.locator("#ref-picker .ref-row");
			// default(main)를 물고 있는 워크트리가 없으므로 지금 보고 있는 것이
			// 맨 위다. 그 행이 자기 브랜치를 오른쪽에 단다.
			await expect(rows.nth(0)).toHaveText(new RegExp(basename(repoDir)));
			await expect(rows.nth(0).locator(".ref-row-tag")).toHaveText("feature");
			await expect(rows.nth(1)).toHaveText(/side/);
			await expect(rows.nth(1).locator(".ref-row-tag")).toHaveText("side/work");
		} finally {
			await stop();
		}
	});

	// 브랜치 구역은 default가 언제나 맨 위 — 사용자가 지정한 규칙이다.
	test("puts the default branch at the top of the branches", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([], OPTS);
		try {
			giveItADefaultBranch(repoDir);
			await page.goto(url);
			await page.locator("#ref-picker-btn").click();
			const rows = page.locator("#ref-picker .ref-row");
			await expect(rows.nth(0)).toHaveText(/main/);
			await expect(rows.nth(0).locator(".ref-row-tag")).toHaveText("default");
		} finally {
			await stop();
		}
	});

	// **이 피커의 존재 이유.** 브랜치를 고르면 그 브랜치의 커밋된 작업을 본다 —
	// 워킹트리의 미커밋 변경은 빠진다. 예전 base 피커는 반대 축을 건드려
	// 남의 브랜치를 골라도 내 워킹트리만 보여줬다.
	test("choosing a branch views its committed work, not the working tree", async ({
		page,
	}) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			// 워크트리 뷰: 커밋된 것 + 미커밋 셋.
			await expect(page.locator("#status")).toHaveText("3 file(s)");

			await page.locator("#ref-picker-btn").click();
			await page
				.locator("#ref-picker .ref-row")
				.filter({ hasText: "feature" })
				.first()
				.click();

			// feature가 main에서 갈라진 뒤 커밋한 것 하나뿐이다.
			await expect(page.locator("#status")).toHaveText("1 file(s)");
			await expect(page.locator("#ref-picker-label")).toHaveText("feature");
			// URL이 진실이라야 새로고침·링크 공유가 그대로 재현된다.
			expect(new URL(page.url()).searchParams.get("head")).toBe("feature");
		} finally {
			await stop();
		}
	});

	// 워크트리는 다른 리포 경로다 — 고르면 그 URL로 이동한다.
	test("choosing a worktree navigates to it", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([], OPTS);
		try {
			const nested = join(repoDir, ".claude", "worktrees", "side");
			run(repoDir, ["worktree", "add", "-q", "-b", "side/work", nested]);

			await page.goto(url);
			await page.locator("#ref-picker-btn").click();
			await page
				.locator("#ref-picker .ref-row")
				.filter({ hasText: "side" })
				.first()
				.click();

			await expect(page.locator("#repo-name")).toHaveText("side");
			expect(new URL(page.url()).searchParams.get("repo")).toBe(
				realpathSync(nested),
			);
		} finally {
			await stop();
		}
	});

	test("never shares the screen with the overflow menu", async ({ page }) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			await page.locator("#overflow-btn").click();
			await expect(page.locator("#overflow-menu")).toBeVisible();

			await page.locator("#ref-picker-btn").click();
			await expect(page.locator("#ref-picker")).toBeVisible();
			await expect(page.locator("#overflow-menu")).toBeHidden();
		} finally {
			await stop();
		}
	});

	// 네이티브 <select>가 공짜로 주던 키보드 조작 — 클릭 전용으로 두면
	// 이 컨트롤만 마우스를 요구하게 된다.
	test("moves with the arrow keys and applies with Enter", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([], OPTS);
		try {
			// default가 맨 위로 올라가야 develop이 0번이 아니게 된다.
			giveItADefaultBranch(repoDir);
			await page.goto(url);
			await page.locator("#ref-picker-btn").click();
			const rows = page.locator("#ref-picker .ref-row");
			await expect(rows.filter({ hasText: "develop" })).toHaveCount(1);

			// 하드코딩하지 않고 보이는 목록에서 위치를 찾아 그만큼 내려간다.
			const labels = await rows.allTextContents();
			const target = labels.findIndex((l) => l.includes("develop"));
			expect(target).toBeGreaterThan(0);
			for (let i = 0; i < target; i++) {
				await page.keyboard.press("ArrowDown");
			}
			await expect(rows.nth(target)).toHaveAttribute("data-active", "true");
			await page.keyboard.press("Enter");

			await expect(page.locator("#ref-picker-label")).toHaveText("develop");
		} finally {
			await stop();
		}
	});
});
