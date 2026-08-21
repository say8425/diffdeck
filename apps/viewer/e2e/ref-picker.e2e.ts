// 견줄 기준 피커: 툴바의 2지선다 <select>를 검색 가능한 목록으로 바꾼 것.
//
// 여기서만 잡히는 계약들이다 — happy-dom에는 레이아웃도 CSS 캐스케이드도
// 없어서 "[hidden]이 실제로 숨기는가", "패널이 정말 페인트되는가",
// "닫을 때 포커스가 트리거로 돌아오는가"를 유닛이 원리적으로 볼 수 없다.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const OPTS = { featureBranchCommit: true, branches: ["develop"] };

const run = (dir: string, args: string[]): void => {
	const r = spawnSync("git", ["-C", dir, ...args], { stdio: "pipe" });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${r.stderr?.toString()}`);
	}
};

test.describe("compare base picker", () => {
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
			const rows = page.locator("#ref-picker .ref-row");
			await expect(rows.filter({ hasText: "Working tree" })).toHaveCount(1);
			await expect(rows.filter({ hasText: "develop" })).toHaveCount(1);

			await page.keyboard.press("Escape");
			await expect(panel).toBeHidden();
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
			// 목록은 /api/refs가 도착한 뒤에 채워진다. count()는 재시도하지
			// 않는 일회성 읽기라, 도착을 기다리는 단언을 먼저 둔다.
			await expect(rows.filter({ hasText: "develop" })).toHaveCount(1);
			expect(await rows.count()).toBeGreaterThan(1);
			await page.locator("#ref-picker-search").fill("develop");
			await expect(rows).toHaveCount(1);
			await expect(rows.first()).toHaveText(/develop/);
		} finally {
			await stop();
		}
	});

	// 기본값은 base=HEAD(미커밋만)이므로 브랜치에 커밋한 파일은 안 보인다.
	// main을 기준으로 고르면 merge-base가 갈림점으로 내려가 그 커밋까지 들어온다.
	test("choosing a branch widens the diff to the committed work", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			await expect(page.locator("#ref-picker-label")).toHaveText(
				"Working tree",
			);
			// 기본 픽스처의 워킹트리 편집은 정확히 셋이다(src/hello.ts,
			// README.md, assets/logo.png).
			await expect(page.locator("#status")).toHaveText("3 file(s)");

			// 브랜치에만 있는 파일을 하나 만든다. 커밋된 뒤 워킹트리에서는
			// 깨끗하므로 HEAD 기준에는 안 보이고, main 기준(갈림점)에서만
			// 보인다 — 그래서 "기준을 바꾸면 비교 범위가 넓어진다"를 개수로
			// 확실히 가른다.
			//
			// featureBranchCommit이 커밋하는 src/hello.ts를 그대로 쓰면 안 된다:
			// 그 파일은 이미 워킹트리에서도 편집돼 있어 기준을 바꿔도 파일
			// 개수가 그대로다. 예전 판이 그걸 모르고 "개수가 달라진다"를
			// 단언했다가, 로컬에서는 status가 아직 "Loading…"일 때 이전 값을
			// 캡처하는 레이스 덕에 통과하고 CI에서만 깨졌다.
			writeFileSync(
				join(repoDir, "src", "branch-only.ts"),
				"export const x = 1;\n",
			);
			run(repoDir, ["add", "src/branch-only.ts"]);
			run(repoDir, ["commit", "-qm", "branch only file"]);

			await page.locator("#ref-picker-btn").click();
			await page
				.locator("#ref-picker .ref-row")
				.filter({ hasText: /^main/ })
				.first()
				.click();

			await expect(page.locator("#ref-picker-label")).toHaveText("vs main");
			await expect(page.locator("#status")).toHaveText("4 file(s)");
			// 닫힌 뒤 포커스가 트리거로 돌아와야 키보드 사용자가 길을 잃지 않는다.
			await expect(page.locator("#ref-picker-btn")).toBeFocused();
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

	// 네이티브 <select>를 없앤 대가로 키보드 조작을 직접 져야 한다. 순서를
	// 하드코딩하지 않고 보이는 목록에서 위치를 찾아 그만큼 내려간다.
	test("moves with the arrow keys and applies with Enter", async ({ page }) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
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

			await expect(page.locator("#ref-picker-label")).toHaveText("vs develop");
		} finally {
			await stop();
		}
	});

	// 고른 브랜치가 나중에 사라지면(PR 머지 후 원격 브랜치 삭제 + prune) 저장된
	// 기준이 400을 부르고, 400은 재시도 없는 terminal이라 손대지 않으면 이후
	// 모든 실행이 실패 카드로 시작한다.
	test("recovers when the remembered branch no longer exists", async ({
		page,
	}) => {
		const { url, repoDir, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			await page.locator("#ref-picker-btn").click();
			await page
				.locator("#ref-picker .ref-row")
				.filter({ hasText: "develop" })
				.first()
				.click();
			await expect(page.locator("#ref-picker-label")).toHaveText("vs develop");

			spawnSync("git", ["-C", repoDir, "branch", "-D", "develop"], {
				stdio: "pipe",
			});
			await page.reload();

			await expect(page.locator("#ref-picker-label")).toHaveText(
				"Working tree",
			);
			await expect(page.locator("diffs-container").first()).toBeVisible();
			await expect(page.locator("#diff")).not.toContainText(
				"Failed to load diff",
			);
		} finally {
			await stop();
		}
	});

	// 두 종류를 화면에서 가르는 것이 이 목록의 요점이다 — Working tree는
	// 미커밋만, 브랜치는 갈라진 뒤 전부라 같은 줄에 같은 모양으로 두면
	// 구분이 안 된다.
	test("separates the working tree from the branches, and says how full it is", async ({
		page,
	}) => {
		const { url, stop } = await launchViewer([], OPTS);
		try {
			await page.goto(url);
			await expect(page.locator("#status")).toHaveText("3 file(s)");
			await page.locator("#ref-picker-btn").click();

			const sections = page.locator("#ref-picker .ref-section");
			await expect(sections).toHaveText([
				"UNCOMMITTED",
				"COMPARE WITH A BRANCH",
			]);

			// 고르기 전에 얼마나 들어 있는지 보여야 "골랐더니 비어 있더라"가
			// 안 생긴다.
			const working = page
				.locator("#ref-picker .ref-row")
				.filter({ hasText: "Working tree" });
			await expect(working.locator(".ref-row-tag")).toHaveText("3 file(s)");
		} finally {
			await stop();
		}
	});
});
