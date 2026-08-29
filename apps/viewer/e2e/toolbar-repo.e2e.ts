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
import { basename } from "node:path";
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

			await expect(page.locator("#repo-name")).toHaveText(name);
			await expect(page.locator("#repo-branch")).toHaveText("· main");

			// 조각 사이에 공백 텍스트 노드가 끼면 `name  · main`이 된다.
			// #repo-branch가 구분자를 품고 오므로 마크업은 붙여 써야 하는데,
			// 그건 포매터가 되돌릴 수 있는 종류의 계약이라 여기서 못박는다.
			await expect(page.locator("#repo-label")).toHaveText(`${name} · main`);

			// 말줄임을 hover로 펴는 보상 패턴(#ref-picker-btn과 같다).
			await expect(page.locator("#repo-label")).toHaveAttribute(
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
			await expect(page.locator("#repo-name")).toHaveText(basename(repoDir));
			await expect(page.locator("#repo-branch")).toHaveText("· feature");
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
			await expect(page.locator("#repo-branch")).toHaveText(
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
			await expect(page.locator("#repo-branch")).toHaveText("· main");

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
						return page.locator("#repo-branch").textContent();
					},
					{ timeout: 15_000, intervals: [500] },
				)
				.toBe(" · other");

			await expect(page).toHaveTitle(`${basename(repoDir)} · other — diffdeck`);
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
			await expect(page.locator("#repo-branch")).toHaveText(`· ${long}`);

			// 상한을 넘지 않는다 — #ref-picker-btn과 같은 260px.
			const labelWidth = await page
				.locator("#repo-label")
				.evaluate((el) => el.getBoundingClientRect().width);
			expect(labelWidth).toBeLessThanOrEqual(260);

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
		} finally {
			await stop();
		}
	});
});
