// 툴바의 리포·브랜치 표식 — "지금 어느 워크트리의 무엇을 보고 있는가".
//
// 이 스펙이 지키는 것은 **배선**이다. 문자열 조립은 `browser/repoLabel.ts`가
// 하고 유닛(`repo-label.test.ts`)이 덮지만, `browser/main.ts`는 커버리지 게이트
// 밖이고 루트 typecheck의 include에도 없어서(bunfig.toml / tsconfig) 배선이
// 통째로 빠져도 유닛·커버리지·타입체크가 전부 초록으로 남는다 — `isLargeFile`
// 사건과 같은 구조다(CLAUDE.md). 여기가 그 구멍을 막는 유일한 지점이다.
//
// 아울러 happy-dom이 원리적으로 못 보는 계약도 함께 잡는다: 라벨이 실제로
// 페인트되는가, 조각 사이에 공백 텍스트 노드가 끼지 않았는가(포매터가
// 되돌릴 수 있다), 긴 브랜치명이 툴바 오른쪽을 화면 밖으로 밀지 않는가.
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
			// 메인 워크트리라 리포 접두가 없다 — 붙으면 `dd-e2e-repo-x / dd-e2e-repo-x`.
			await expect(page.locator("#picker-scope")).toBeEmpty();

			// 개수 바로 왼쪽 자리는 이제 **견줄 기준**의 몫이다 — 트리거가
			// "무엇을 보는가"를 말하므로 그 자리에 같은 말을 두면 중복이다.
			const beforeStatus = await page.evaluate(
				() =>
					document.getElementById("base-label")?.nextElementSibling?.id ?? null,
			);
			expect(beforeStatus).toBe("status");

			// 조각 사이에 공백 텍스트 노드가 끼면 `name  · main`이 된다.
			// #picker-branch가 구분자를 품고 오므로 마크업은 붙여 써야 하는데,
			// 그건 포매터가 되돌릴 수 있는 종류의 계약이라 여기서 못박는다.
			// **toHaveText로는 못 잡는다** — Playwright가 공백을 정규화해서
			// 이중 공백도 통과시킨다. textContent를 그대로 봐야 한다.
			expect(
				await page
					.locator("#ref-picker-label")
					.evaluate((el) => el.textContent),
			).toBe(`${name} · main`);

			// 말줄임을 hover로 편다 — 트리거가 세 조각을 담아 길어질 수 있다.
			await expect(page.locator("#ref-picker-btn")).toHaveAttribute(
				"title",
				`${realpathSync(repoDir)} · main`,
			);

			// 탭 제목 — 워크트리를 여럿 열어 두면 탭만으로 구별돼야 한다.
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

	// 브랜치가 없는 상태에서 `name · ` 처럼 끝나면 안 된다. detached 표기는
	// emptyState.ts와 **같은 어휘**를 쓴다 — 같은 사실을 화면 두 곳이 다르게
	// 말하면 안 되기 때문. /api/refs의 head는 full OID라 앞 7자로 잘린다.
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

	// 부팅 시 한 번만 읽는 구현을 떨어뜨린다. 브랜치를 갈아타고 창으로
	// 돌아오는 것(focus → load)이 뷰어를 켜 둔 채 일할 때의 실제 흐름이다.
	test("follows a branch switch made while the viewer is open", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			await page.goto(url);
			await expect(page.locator("#picker-branch")).toHaveText("· main");

			run(repoDir, ["checkout", "-qb", "other"]);

			// focus를 한 번이 아니라 **수렴할 때까지** 보낸다. /api/refs는 5초
			// TTL 캐시라(server.ts의 REFS_TTL_MS) 전환 직후의 첫 갱신은 캐시된
			// 값을 읽을 수 있다 — 라벨은 피커와 같은 데이터를 같은 신선도로
			// 쓰므로 이건 결함이 아니라 설계된 수렴 지연이다. 고정 sleep 대신
			// 폴링으로 적는 이유는 이 스펙이 지키려는 것이 "몇 초 안에"가 아니라
			// "부팅 때 한 번만 읽지 않는다"이기 때문이다.
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

	// 사용자가 실제로 겪은 형태: 한 리포의 워크트리를 여럿 열어 두고 일한다.
	// 워크트리 이름만 보이면 어느 리포인지 알 수 없고, 리포 이름만 보이면 어느
	// 워크트리인지 알 수 없다 — 라벨이 둘 다 말해야 탭을 잘못 고르지 않는다.
	test("names the repo and the worktree when inside a linked worktree", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			// 사용자 리포와 같은 중첩 배치(`<repo>/.claude/worktrees/*`).
			const nested = join(repoDir, ".claude", "worktrees", "feat+ABC-1");
			run(repoDir, ["worktree", "add", "-q", "-b", "feat/ABC-1", nested]);

			// repo는 URL 파라미터라 워크트리를 가리키게 바꾸면 그대로 열린다.
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

			// 탭 제목에는 리포 접두가 없다 — 탭은 오른쪽부터 잘리는데 리포
			// 이름은 워크트리마다 같아서 탭을 가르지 못한다.
			await expect(page).toHaveTitle("feat+ABC-1 · feat/ABC-1 — diffdeck");
		} finally {
			await stop();
		}
	});

	// watch는 창을 **안 보고 있을 때** 쓰는 기능이라 focus가 발화하지 않는다.
	// 갱신이 load()에만 걸려 있으면 diff는 2초마다 새 브랜치 것으로 갈리는데
	// 툴바·탭 제목만 옛 브랜치에 무기한 굳고, 같은 화면의 빈 상태 카드는
	// /api/summary로 살아 있는 브랜치를 말해 한 화면이 두 브랜치를 동시에
	// 주장하게 된다. 그래서 이 스펙은 focus를 **한 번도 보내지 않는다** —
	// 그게 위 ④와 갈라지는 지점이고, poll()의 갱신을 지우면 여기만 빨개진다.
	test("keeps the label live under --watch without any focus event", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer(["--watch"]);
		try {
			await page.goto(url);
			await expect(page.locator("#picker-branch")).toHaveText("· main");

			run(repoDir, ["checkout", "-qb", "watched"]);

			// 폴 주기 + /api/refs의 5초 TTL만큼 수렴을 기다린다.
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

	// 브랜치를 head로 보면 **워크트리는 결과에 영향을 주지 않는다** — 어느
	// 워크트리에서 보든 같은 diff다. 그래서 라벨에서 워크트리 이름을 빼고
	// 보고 있는 브랜치를 주인공으로 세운다. 예전에는 워크트리의 브랜치를
	// 말해서, 화면에는 A의 diff가 떠 있는데 라벨은 B라고 하는 상태가 됐다.
	test("a branch head drops the worktree name and says what it is viewing", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([], {
			branches: ["develop"],
			featureBranchCommit: true,
		});
		try {
			await page.goto(url);
			// 워크트리 뷰에서는 그 워크트리의 브랜치를 말한다.
			await expect(page.locator("#picker-branch")).toHaveText("· feature");

			await page.locator("#ref-picker-btn").click();
			await page
				.locator("#ref-picker .ref-row")
				.filter({ hasText: /^develop/ })
				.first()
				.click();

			await expect(page.locator("#picker-name")).toHaveText("develop");
			// 브랜치 뷰에서는 head 자체가 브랜치라 트리거가 따로 말할 것이 없다.
			await expect(page.locator("#picker-branch")).toBeEmpty();
			await expect(page.locator("#picker-scope")).toHaveText(
				`${basename(repoDir)} ·`,
			);
			// 견줄 기준이 자동 해석으로 올라간다 — 커밋된 rev에는 미커밋
			// 변경이 없어 워킹트리 기준은 뜻이 없다. 다른 축이므로 자기 자리다.
			await expect(page.locator("#base-label")).toHaveText("vs main");
			// 워크트리의 브랜치를 말하면 보고 있지도 않은 곳을 가리킨다.
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

	// 유닛이 원리적으로 못 보는 계약: happy-dom에는 레이아웃이 없다.
	// 툴바에는 flex-wrap도 @media도 없어서, max-width + ellipsis가 빠지면
	// 긴 이름 하나로 .tb-right(찾기·트리토글·⋯)가 화면 밖으로 나간다.
	test("a very long branch name never pushes the toolbar off screen", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			const long = `feature/${"very-long-branch-segment-".repeat(6)}end`;
			run(repoDir, ["checkout", "-qb", long]);

			await page.goto(url);
			await expect(page.locator("#picker-branch")).toHaveText(`· ${long}`);

			// 담기지 않으면 잘린다. 픽셀 상한을 단언하지 않는 이유는 폭을 붙드는
			// 기제가 max-width가 아니라 flex shrink이기 때문이다 — 상한을 두면
			// 공간이 남는 넓은 창에서까지 자르게 된다(실측 근거는 CSS 주석에).
			// 이 단언이 `.tb-picker { display: flex }`의 회귀망이다: 블록이면
			// 안쪽 inline-flex 버튼이 flex item이 아니라 줄어드는 몫을 못 받아
			// 자연폭 그대로 넘치고, 라벨은 한 번도 잘리지 않는다.
			const label = await page.locator("#ref-picker-label").evaluate((el) => ({
				clipped: el.scrollWidth > el.clientWidth,
				// text-overflow를 지우면 잘린 자리에 말줄임표가 사라진다.
				// scrollWidth로는 그 삭제를 못 보므로 계산된 값을 직접 본다.
				textOverflow: getComputedStyle(el).textOverflow,
			}));
			expect(label.clipped).toBe(true);
			expect(label.textOverflow).toBe("ellipsis");

			// 오른쪽 그룹이 뷰포트 안에 그대로 있다.
			const viewport = page.viewportSize();
			if (!viewport) throw new Error("viewport size unavailable");
			const right = await page
				.locator(".tb-right")
				.evaluate((el) => el.getBoundingClientRect().right);
			expect(right).toBeLessThanOrEqual(viewport.width);

			// 툴바가 한 줄로 남는다 (줄바꿈되면 높이가 배로 뛴다).
			const toolbarHeight = await page
				.locator("#toolbar")
				.evaluate((el) => el.getBoundingClientRect().height);
			expect(toolbarHeight).toBeLessThan(60);

			// 좁은 창 — 트리거가 줄어드는 몫을 **전담**해야 한다. 실측 근거:
			// `.tb-left { min-width: 0 }`이 없으면 여기서 .tb-right가 화면 밖으로
			// 나가고(표식이 없던 시절엔 460px에서도 멀쩡했다), `.tb-left > *`의
			// flex:none이 없으면 #status가 두 줄로 접혀 툴바가 43 → 49px로 뛴다.
			// 트리거는 `.tb-picker`의 flex:0 1 auto로 그 예외를 되돌려 받는다.
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
					// overflow:hidden / text-overflow:ellipsis를 지우면 사라진다.
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
