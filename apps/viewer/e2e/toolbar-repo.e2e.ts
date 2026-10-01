// 툴바 트리거 라벨의 배선 회귀망(viewer-toolbar.md). 조립은 repoLabel.ts의
// 유닛이 덮지만 main.ts는 커버리지·타입체크 밖이라 배선과 레이아웃은 여기서만
// 잡힌다.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const run = (dir: string, args: string[]): void => {
	const r = spawnSync("git", ["-C", dir, ...args], { stdio: "pipe" });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${r.stderr?.toString()}`);
	}
};

const capture = (dir: string, args: string[]): string => {
	const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
	}
	return r.stdout.trim();
};

test.describe("toolbar repo label", () => {
	test("says the worktree name and its branch", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			await page.goto(url);
			const name = basename(repoDir);

			await expect(page.locator("#picker-name")).toHaveText(name);
			await expect(page.locator("#picker-branch")).toHaveText("· main");
			// 메인 워크트리에는 리포 접두가 없다.
			await expect(page.locator("#picker-scope")).toBeEmpty();

			expect(await page.locator("#base-label").count()).toBe(0);
			const beforeStatus = await page.evaluate(
				() =>
					document.getElementById("pr-chip")?.nextElementSibling?.id ?? null,
			);
			expect(beforeStatus).toBe("status");
			await expect(page.locator("#pr-chip")).toBeHidden();

			// 조각 사이에 공백 텍스트 노드가 끼면 안 된다(포매터가 되돌릴 수 있는
			// 마크업 계약). toHaveText는 공백을 정규화해 못 잡으므로 textContent를
			// 그대로 본다.
			expect(
				await page
					.locator("#ref-picker-label")
					.evaluate((el) => el.textContent),
			).toBe(`${name} · main`);

			await expect(page.locator("#ref-picker-btn")).toHaveAttribute(
				"title",
				`${realpathSync(repoDir)} · main`,
			);

			await expect(page).toHaveTitle(`${name} · main — diffdeck`);
		} finally {
			await stop();
		}
	});

	test("says the checked-out branch, not the default one", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([], {
			clean: true,
			featureBranchCommit: true,
		});
		try {
			await page.goto(url);
			await expect(page.locator("#picker-name")).toHaveText(basename(repoDir));
			await expect(page.locator("#picker-branch")).toHaveText("· feature");
		} finally {
			await stop();
		}
	});

	// detached는 빈 상태 카드(emptyState.ts)와 같은 어휘로 말한다.
	test("falls back to a short OID on detached HEAD", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([], { clean: true });
		try {
			const sha = capture(repoDir, ["rev-parse", "HEAD"]);
			run(repoDir, ["checkout", "-q", sha]);

			await page.goto(url);
			await expect(page.locator("#picker-branch")).toHaveText(
				`· detached @ ${sha.slice(0, 7)}`,
			);
		} finally {
			await stop();
		}
	});

	// 부팅 때 한 번만 읽는 구현을 떨어뜨린다(창으로 돌아오는 focus → load).
	test("follows a branch switch made while the viewer is open", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			await page.goto(url);
			await expect(page.locator("#picker-branch")).toHaveText("· main");

			run(repoDir, ["checkout", "-qb", "other"]);

			// /api/refs는 TTL 캐시라 전환 직후의 갱신이 옛 값일 수 있다 — 수렴할
			// 때까지 focus를 보낸다.
			await expect
				.poll(
					async () => {
						await page.evaluate(() => window.dispatchEvent(new Event("focus")));
						return page.locator("#picker-branch").textContent();
					},
					{ timeout: 15_000, intervals: [500] },
				)
				.toBe(" · other");

			await expect(page).toHaveTitle(`${basename(repoDir)} · other — diffdeck`);
		} finally {
			await stop();
		}
	});

	test("names the repo and the worktree when inside a linked worktree", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			// 중첩 배치(`<repo>/.claude/worktrees/*`) — 바깥 리포가 아니라 이
			// 워크트리가 이겨야 한다(findWorktree).
			const nested = join(repoDir, ".claude", "worktrees", "feat+ABC-1");
			run(repoDir, ["worktree", "add", "-q", "-b", "feat/ABC-1", nested]);

			// git이 보고하는 경로와 맞추려고 realpath로 정규화한다(macOS의
			// /var → /private/var 심링크).
			const target = new URL(url);
			target.searchParams.set("repo", realpathSync(nested));
			await page.goto(target.toString());

			await expect(page.locator("#picker-scope")).toHaveText(
				`${basename(repoDir)} /`,
			);
			await expect(page.locator("#picker-name")).toHaveText("feat+ABC-1");
			await expect(page.locator("#picker-branch")).toHaveText("· feat/ABC-1");

			await expect(page).toHaveTitle("feat+ABC-1 · feat/ABC-1 — diffdeck");
		} finally {
			await stop();
		}
	});

	// focus를 한 번도 보내지 않는다 — watch는 창을 안 볼 때 쓰므로 poll()의
	// 갱신만으로 수렴해야 한다. focus를 보내면 load()가 대신 갱신해 빈 통과가 된다.
	test("keeps the label live under --watch without any focus event", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer(["--watch"]);
		try {
			await page.goto(url);
			await expect(page.locator("#picker-branch")).toHaveText("· main");

			run(repoDir, ["checkout", "-qb", "watched"]);

			// 폴 주기 + /api/refs TTL만큼 기다린다.
			await expect(page.locator("#picker-branch")).toHaveText("· watched", {
				timeout: 20_000,
			});
			await expect(page).toHaveTitle(
				`${basename(repoDir)} · watched — diffdeck`,
			);
		} finally {
			await stop();
		}
	});

	test("a branch head drops the worktree name and says what it is viewing", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([], {
			branches: ["develop"],
			featureBranchCommit: true,
		});
		try {
			await page.goto(url);
			await expect(page.locator("#picker-branch")).toHaveText("· feature");

			await page.locator("#ref-picker-btn").click();
			await page
				.locator("#ref-picker .ref-row")
				.filter({ hasText: /^develop/ })
				.first()
				.click();

			await expect(page.locator("#picker-name")).toHaveText("develop");
			// head가 곧 브랜치라 브랜치 조각은 비어 있다.
			await expect(page.locator("#picker-branch")).toBeEmpty();
			await expect(page.locator("#picker-scope")).toHaveText(
				`${basename(repoDir)} ·`,
			);
			expect(
				await page
					.locator("#ref-picker-label")
					.evaluate((el) => el.textContent),
			).not.toContain("feature");
			await expect(page).toHaveTitle("develop — diffdeck");
		} finally {
			await stop();
		}
	});

	// 툴바는 줄바꿈하지 않아서 flex shrink 사슬(viewer-toolbar.md)이 끊기면 긴
	// 이름 하나로 .tb-right가 화면 밖으로 나간다. 레이아웃이라 유닛은 못 잡는다.
	test("a very long branch name never pushes the toolbar off screen", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			const long = `feature/${"very-long-branch-segment-".repeat(6)}end`;
			run(repoDir, ["checkout", "-qb", long]);

			await page.goto(url);
			await expect(page.locator("#picker-branch")).toHaveText(`· ${long}`);

			// 픽셀 상한이 아니라 잘림을 단언한다 — 폭은 max-width가 아니라 flex
			// shrink가 붙든다. `.tb-picker { display: flex }`가 빠지면 라벨이 한
			// 번도 잘리지 않아 여기서 잡힌다.
			const label = await page.locator("#ref-picker-label").evaluate((el) => ({
				clipped: el.scrollWidth > el.clientWidth,
				// scrollWidth로는 text-overflow 삭제를 못 봐서 계산값을 본다.
				textOverflow: getComputedStyle(el).textOverflow,
			}));
			expect(label.clipped).toBe(true);
			expect(label.textOverflow).toBe("ellipsis");

			const viewport = page.viewportSize();
			if (!viewport) throw new Error("viewport size unavailable");
			const right = await page
				.locator(".tb-right")
				.evaluate((el) => el.getBoundingClientRect().right);
			expect(right).toBeLessThanOrEqual(viewport.width);

			// 툴바가 한 줄로 남는다(줄바꿈되면 높이가 배로 뛴다).
			const toolbarHeight = await page
				.locator("#toolbar")
				.evaluate((el) => el.getBoundingClientRect().height);
			expect(toolbarHeight).toBeLessThan(60);

			// 좁은 창: `.tb-left { min-width: 0 }`이 없으면 .tb-right가 넘치고,
			// `.tb-left > * { flex: none }`이 없으면 #status가 두 줄로 접혀 툴바가
			// 높아진다.
			await page.setViewportSize({ width: 560, height: 720 });
			await page.waitForTimeout(200);
			const narrow = await page.evaluate(() => {
				const trigger = document.getElementById("ref-picker-label");
				const rightGroup = document.querySelector(".tb-right");
				const toolbar = document.getElementById("toolbar");
				if (!trigger || !rightGroup || !toolbar) {
					throw new Error("toolbar nodes missing");
				}
				return {
					rightEdge: rightGroup.getBoundingClientRect().right,
					height: toolbar.getBoundingClientRect().height,
					clipped: trigger.scrollWidth > trigger.clientWidth,
				};
			});
			expect(narrow.rightEdge).toBeLessThanOrEqual(560);
			expect(narrow.height).toBeLessThan(48);
			expect(narrow.clipped).toBe(true);
		} finally {
			await stop();
		}
	});
});
