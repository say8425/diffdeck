// PR 표시 — 툴바 칩과 피커 행의 둘째 줄.
//
// 문자열·판정은 `browser/prBadge.ts`·`refPicker/model.ts`가 하고 유닛이 덮지만,
// `main.ts`는 커버리지 게이트와 typecheck 밖이라 배선이 통째로 빠져도 유닛은
// 초록이다. 게다가 happy-dom엔 레이아웃이 없어 "칩이 좁은 창에서 툴바 오른쪽을
// 밀지 않는가"·"PR 아이콘이 선택 체크처럼 절대 위치로 날아가지 않는가"는
// 여기서만 보인다.
//
// **실제 `gh`는 못 쓴다** — GitHub에 가야 해서 픽스처 리포로는 빈 결과뿐이다.
// 그래서 `pr list`에만 고정 JSON을 답하는 가짜 `gh`를 PATH 앞에 둔다(`pr view`
// 등 나머지는 실패로 답해 base 해석은 평소처럼 기본 브랜치로 떨어진다).
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const LONG_TITLE =
	"feat: 기능 브랜치에서 PR 칩이 좁은 창에서도 툴바 오른쪽을 밀어내지 않는지 보는 긴 제목";

const PRS = [
	{
		number: 12,
		title: LONG_TITLE,
		headRefName: "feature",
		state: "OPEN",
		isDraft: false,
		url: "https://github.com/o/r/pull/12",
		isCrossRepository: false,
	},
	{
		number: 3,
		title: "chore: develop 정리",
		headRefName: "develop",
		state: "MERGED",
		isDraft: false,
		url: "https://github.com/o/r/pull/3",
		isCrossRepository: false,
	},
	{
		number: 14,
		title: "feat: 진행 중인 작업",
		headRefName: "wip",
		state: "OPEN",
		isDraft: true,
		url: "https://github.com/o/r/pull/14",
		isCrossRepository: false,
	},
	{
		number: 2,
		title: "fix: 버린 시도",
		headRefName: "old",
		state: "CLOSED",
		isDraft: false,
		url: "https://github.com/o/r/pull/2",
		isCrossRepository: false,
	},
	// 포크의 `main`에서 온 PR — 우리 `main`에 붙으면 안 된다.
	{
		number: 99,
		title: "fork: 남의 main",
		headRefName: "main",
		state: "OPEN",
		isDraft: false,
		url: "https://github.com/o/r/pull/99",
		isCrossRepository: true,
	},
];

const launchWithPrs = async (flags: string[] = []) => {
	const ghDir = mkdtempSync(join(tmpdir(), "dd-e2e-gh-"));
	const json = join(ghDir, "prs.json");
	writeFileSync(json, JSON.stringify(PRS));
	const gh = join(ghDir, "gh");
	writeFileSync(
		gh,
		`#!/bin/sh\nif [ "$1" = "pr" ] && [ "$2" = "list" ]; then cat "${json}"; exit 0; fi\nexit 1\n`,
	);
	chmodSync(gh, 0o755);
	const viewer = await launchViewer(
		flags,
		{ branches: ["develop", "wip", "old"], featureBranchCommit: true },
		undefined,
		{ PATH: `${ghDir}:${process.env.PATH ?? ""}` },
	);
	return {
		...viewer,
		stop: async () => {
			await viewer.stop();
			rmSync(ghDir, { recursive: true, force: true });
		},
	};
};

test.describe("PR badges", () => {
	test("① the toolbar chip names the branch's PR and opens it on GitHub", async ({
		page,
	}) => {
		const { url, stop } = await launchWithPrs();
		try {
			await page.goto(url);
			const chip = page.locator("#pr-chip");
			await expect(chip).toBeVisible();
			await expect(page.locator("#pr-chip-number")).toHaveText("#12");
			await expect(page.locator("#pr-chip-title")).toHaveText(LONG_TITLE);
			await expect(chip).toHaveAttribute(
				"href",
				"https://github.com/o/r/pull/12",
			);
			// 새 탭으로 연다 — diff 화면을 잃지 않는다.
			await expect(chip).toHaveAttribute("target", "_blank");
			await expect(chip).toHaveAttribute("rel", /noopener/);
			await expect(chip).toHaveAttribute(
				"title",
				`#12 ${LONG_TITLE} — Open on GitHub`,
			);
			// 상태는 글자가 아니라 아이콘이 말한다 — 보조기술엔 aria-label로.
			await expect(
				page.getByRole("link", {
					name: `Open pull request #12: ${LONG_TITLE}`,
				}),
			).toBeVisible();
			await expect(chip.locator(".pr-icon")).toHaveAttribute(
				"data-state",
				"open",
			);
			// `vs main`은 걷어냈다.
			expect(await page.locator("#base-label").count()).toBe(0);
		} finally {
			await stop();
		}
	});

	test("② the chip follows the head: merged PR, then none", async ({
		page,
	}) => {
		const { url, stop } = await launchWithPrs();
		try {
			await page.goto(url);
			await expect(page.locator("#pr-chip-number")).toHaveText("#12");

			const pick = async (name: string) => {
				await page.locator("#ref-picker-btn").click();
				await page
					.locator("#ref-picker .ref-row")
					.filter({ hasText: new RegExp(`^${name}`) })
					.first()
					.click();
			};

			await pick("develop");
			await expect(page.locator("#picker-name")).toHaveText("develop");
			await expect(page.locator("#pr-chip-number")).toHaveText("#3");
			await expect(page.locator("#pr-chip .pr-icon")).toHaveAttribute(
				"aria-label",
				"Merged pull request",
			);

			// 포크 PR은 무시되므로 main에는 PR이 없다 → 칩이 숨는다(빈 상자가
			// 남으면 author display의 [hidden] 짝이 빠진 것이다).
			await pick("main");
			await expect(page.locator("#picker-name")).toHaveText("main");
			await expect(page.locator("#pr-chip")).toBeHidden();
			expect(
				await page
					.locator("#pr-chip")
					.evaluate((el) => getComputedStyle(el).display),
			).toBe("none");
		} finally {
			await stop();
		}
	});

	test("③ picker rows show the PR on a second line with a state icon", async ({
		page,
	}) => {
		const { url, stop } = await launchWithPrs();
		try {
			await page.goto(url);
			await page.locator("#ref-picker-btn").click();
			const row = (name: string) =>
				page
					.locator("#ref-picker .ref-row")
					.filter({ hasText: new RegExp(`^${name}`) })
					.first();

			const expected: Array<[string, string, string]> = [
				["feature", "#12", "Open pull request"],
				["develop", "#3", "Merged pull request"],
				["wip", "#14", "Draft pull request"],
				["old", "#2", "Closed pull request"],
			];
			for (const [name, number, label] of expected) {
				const r = row(name);
				await expect(r.locator(".ref-row-pr-number")).toHaveText(number);
				await expect(r.locator(".ref-row-pr svg")).toHaveAttribute(
					"aria-label",
					label,
				);
			}
			// 상태를 글자로 되풀이하지 않는다.
			await expect(row("wip").locator(".ref-row-pr")).not.toContainText(
				"Draft",
			);

			// PR 없는 행은 한 줄 그대로다.
			await expect(row("main").locator(".ref-row-pr")).toHaveCount(0);
			const heights = await Promise.all(
				["main", "develop"].map((n) =>
					row(n).evaluate((el) => el.getBoundingClientRect().height),
				),
			);
			expect(heights[0]).toBe(26);
			expect(heights[1]).toBeGreaterThan(26);

			// 선택 체크의 절대 위치 규칙(`.ref-row > svg`)이 PR 아이콘까지 잡으면
			// 아이콘이 행 왼쪽 끝으로 날아가 체크 자리에 겹친다.
			expect(
				await row("develop")
					.locator(".ref-row-pr svg")
					.evaluate((el) => getComputedStyle(el).position),
			).toBe("static");
		} finally {
			await stop();
		}
	});

	test("④ the filter finds rows by PR number and title", async ({ page }) => {
		const { url, stop } = await launchWithPrs();
		try {
			await page.goto(url);
			await page.locator("#ref-picker-btn").click();
			const labels = page.locator("#ref-picker .ref-row .ref-row-label");
			await expect(labels.first()).toBeVisible();

			await page.locator("#ref-picker-search").fill("#14");
			await expect(labels).toHaveText(["wip"]);
			await page.locator("#ref-picker-search").fill("버린");
			await expect(labels).toHaveText(["old"]);
		} finally {
			await stop();
		}
	});

	// 유닛이 원리적으로 못 보는 계약: 칩은 트리거와 함께 줄어드는 몫을 진다.
	// 유닛이 원리적으로 못 보는 계약: 칩은 줄어드는 몫을 **트리거보다 먼저**
	// 진다(index.html의 `#pr-chip` 주석). 둘의 shrink가 같으면 긴 PR 제목이
	// 몫을 나눠 가져, 트리거만으로는 들어갈 폭에서도 트리거가 잘린다.
	test("⑤ in a narrow window the chip title yields first and the toolbar stays on screen", async ({
		page,
	}) => {
		const { url, stop } = await launchWithPrs();
		try {
			await page.goto(url);
			await expect(page.locator("#pr-chip-number")).toHaveText("#12");
			const measure = () =>
				page.evaluate(() => {
					const rect = (sel: string) =>
						(
							document.querySelector(sel) as HTMLElement
						).getBoundingClientRect();
					const label = document.getElementById(
						"ref-picker-label",
					) as HTMLElement;
					const title = document.getElementById("pr-chip-title") as HTMLElement;
					return {
						triggerWhole: label.scrollWidth <= label.clientWidth,
						titleClipped: title.scrollWidth > title.clientWidth,
						numberRight: rect("#pr-chip-number").right,
						chipRight: rect("#pr-chip").right,
						statusLeft: rect("#status").left,
						rightEdge: rect(".tb-right").right,
						toolbarHeight: rect("#toolbar").height,
					};
				});

			// 트리거는 온전히 들어가는 폭 — 제목만 말줄임돼야 한다.
			await page.setViewportSize({ width: 720, height: 600 });
			const mid = await measure();
			expect(mid.titleClipped).toBe(true);
			expect(mid.triggerWhole).toBe(true);

			// 더 좁으면 트리거도 줄지만 번호는 칩 안에 남고, 칩이 개수를 덮거나
			// 오른쪽 그룹을 밀지 않는다.
			for (const width of [720, 560]) {
				await page.setViewportSize({ width, height: 600 });
				const m = await measure();
				expect(m.numberRight).toBeLessThanOrEqual(m.chipRight);
				expect(m.chipRight).toBeLessThanOrEqual(m.statusLeft);
				expect(m.rightEdge).toBeLessThanOrEqual(width);
				expect(m.toolbarHeight).toBeLessThanOrEqual(43);
			}
		} finally {
			await stop();
		}
	});

	// watch의 폴(2초)은 매번 /api/prs를 다시 묻고 서버는 60초 동안 같은 값을
	// 준다. 같은 값에도 열린 피커를 다시 세우면 누르는 도중 행 노드가 갈려
	// click이 사라진다 — 같은 응답이면 아무것도 다시 그리지 않아야 한다.
	test("⑥ under --watch an open picker is not rebuilt by unchanged PRs", async ({
		page,
	}) => {
		const { url, stop } = await launchWithPrs(["--watch"]);
		try {
			await page.goto(url);
			await page.locator("#ref-picker-btn").click();
			const row = page.locator("#ref-picker .ref-row").first();
			await expect(row.locator(".ref-row-pr")).toHaveCount(1);
			await row.evaluate((el) => {
				(el as HTMLElement & { ddMark?: boolean }).ddMark = true;
			});
			// 폴 두 번 이상.
			await page.waitForTimeout(5_000);
			expect(
				await page
					.locator("#ref-picker .ref-row")
					.first()
					.evaluate(
						(el) => (el as HTMLElement & { ddMark?: boolean }).ddMark === true,
					),
			).toBe(true);
		} finally {
			await stop();
		}
	});
});
