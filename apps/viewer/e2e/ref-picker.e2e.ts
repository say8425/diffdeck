import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const OPTS = { featureBranchCommit: true, branches: ["develop"] };

// 픽스처엔 원격이 없어 default 브랜치가 풀리지 않는다 — 원격 HEAD symref만 직접
// 세운다. `git remote add`는 쓰지 않는다: 원격 URL이 생기면 base 해석의
// `gh pr view`가 GitHub를 찾느라 스펙마다 수십 초가 걸린다.
const giveItADefaultBranch = (dir: string): void => {
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
			// `#ref-picker[hidden]` 짝이 빠지면 처음부터 열린 채로 보인다.
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
			// default 브랜치를 물고 있는 워크트리가 없어 지금 보는 워크트리가 맨 위다.
			await expect(rows.nth(0)).toHaveText(new RegExp(basename(repoDir)));
			await expect(rows.nth(0).locator(".ref-row-tag")).toHaveText("feature");
			await expect(rows.nth(1)).toHaveText(/side/);
			await expect(rows.nth(1).locator(".ref-row-tag")).toHaveText("side/work");
		} finally {
			await stop();
		}
	});

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

	test("choosing a branch views its committed work, not the working tree", async ({
		page,
	}) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			// 워킹트리 뷰는 미커밋 변경 셋이다.
			await expect(page.locator("#status")).toHaveText("3 file(s)");

			await page.locator("#ref-picker-btn").click();
			await page
				.locator("#ref-picker .ref-row")
				.filter({ hasText: "feature" })
				.first()
				.click();

			// feature가 main에서 갈라진 뒤 커밋한 것 하나뿐이다.
			await expect(page.locator("#status")).toHaveText("1 file(s)");
			await expect(page.locator("#picker-name")).toHaveText("feature");
			expect(new URL(page.url()).searchParams.get("head")).toBe("feature");
			expect(
				await page.evaluate(() =>
					Object.keys(localStorage).filter((k) => k.includes("head")),
				),
			).toEqual([]);
		} finally {
			await stop();
		}
	});

	test("choosing a worktree navigates to it", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([], OPTS);
		try {
			const nested = join(repoDir, ".claude", "worktrees", "side");
			run(repoDir, ["worktree", "add", "-q", "-b", "side/work", nested]);

			await page.goto(url);
			// 먼저 head를 세운다 — URL에 head가 없으면 이동이 head를 들고 가도 아래
			// 단언이 통과한다.
			await page.locator("#ref-picker-btn").click();
			// hasText로는 "feature"를 태그로 단 워크트리 행이 먼저 잡혀서
			// `data-value`로 고른다.
			await page.locator('#ref-picker .ref-row[data-value="feature"]').click();
			expect(new URL(page.url()).searchParams.get("head")).toBe("feature");

			await page.locator("#ref-picker-btn").click();
			await page
				.locator("#ref-picker .ref-row")
				.filter({ hasText: "side" })
				.first()
				.click();

			await expect(page.locator("#picker-name")).toHaveText("side");
			expect(new URL(page.url()).searchParams.get("repo")).toBe(
				realpathSync(nested),
			);
			expect(new URL(page.url()).searchParams.get("head")).toBeNull();
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

	test("moves with the arrow keys and applies with Enter", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([], OPTS);
		try {
			// default가 맨 위로 올라가야 develop이 0번이 아니게 되어 화살표를 누른다.
			giveItADefaultBranch(repoDir);
			await page.goto(url);
			await page.locator("#ref-picker-btn").click();
			const rows = page.locator("#ref-picker .ref-row");
			await expect(rows.filter({ hasText: "develop" })).toHaveCount(1);

			const labels = await rows.allTextContents();
			const target = labels.findIndex((l) => l.includes("develop"));
			expect(target).toBeGreaterThan(0);
			for (let i = 0; i < target; i++) {
				await page.keyboard.press("ArrowDown");
			}
			await expect(rows.nth(target)).toHaveAttribute("data-active", "true");
			await page.keyboard.press("Enter");

			await expect(page.locator("#picker-name")).toHaveText("develop");
		} finally {
			await stop();
		}
	});

	test("a head that no longer exists says so and offers a way out", async ({
		page,
	}) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(`${url}&head=gone-branch`);

			const card = page.locator("#empty.empty-card");
			await expect(card.locator(".empty-headline")).toHaveText(
				"That branch is gone",
			);
			await expect(card.locator(".empty-context")).toHaveText(
				"No ref named gone-branch in this repo",
			);

			expect(new URL(page.url()).searchParams.get("head")).toBe("gone-branch");

			await card.locator("button.empty-action").click();
			await expect(page.locator("#status")).toHaveText(/file\(s\)/);
			expect(new URL(page.url()).searchParams.get("head")).toBeNull();
		} finally {
			await stop();
		}
	});
});
