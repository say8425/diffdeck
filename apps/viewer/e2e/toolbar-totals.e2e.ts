// 툴바의 전체 변경량 — 개수(`n file(s)`) 오른쪽에서 "통틀어 몇 줄인가"를 말한다.
//
// 합산은 `browser/changeTotals.ts`(유닛 100%)가 하지만, `main.ts`는 커버리지
// 게이트 밖이라 배선이 통째로 빠져도 유닛은 전부 초록이다. 여기가 그 구멍을
// 막는다. 아울러 **숫자가 git과 같은가**는 실제 git 없이는 확인할 수 없으므로
// 기대값을 스펙 안에서 git으로 직접 계산해 대조한다.
import { spawnSync } from "node:child_process";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const capture = (dir: string, args: string[]): string => {
	const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
	}
	return r.stdout;
};

/** `git diff --numstat`의 합. 바이너리는 줄 수가 `-`로 나오므로 뺀다. */
const gitTotals = (dir: string, rev: string): { add: number; del: number } => {
	let add = 0;
	let del = 0;
	for (const line of capture(dir, ["diff", "--numstat", rev]).split("\n")) {
		const [a, d] = line.split("\t");
		if (a === undefined || a === "" || a === "-") continue;
		add += Number(a);
		del += Number(d);
	}
	return { add, del };
};

test.describe("toolbar change totals", () => {
	test("sums the whole diff and agrees with git", async ({ page }) => {
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			await page.goto(url);
			await expect(page.locator("#status")).toHaveText("3 file(s)");

			// 기본 뷰는 워킹트리(HEAD 대비)다.
			const { add, del } = gitTotals(repoDir, "HEAD");
			expect(add).toBeGreaterThan(0);

			await expect(page.locator("#change-add")).toHaveText(`+${add}`);
			await expect(page.locator("#change-del")).toHaveText(`-${del}`);

			// 사용자가 지정한 자리: 개수 **오른쪽**.
			const afterStatus = await page.evaluate(
				() => document.getElementById("status")?.nextElementSibling?.id ?? null,
			);
			expect(afterStatus).toBe("change-totals");

			// 조각 사이에 공백 텍스트 노드가 끼면 `+7  -1`이 된다.
			// toHaveText는 공백을 정규화하므로 textContent를 그대로 본다.
			expect(
				await page.locator("#change-totals").evaluate((el) => el.textContent),
			).toBe(`+${add} -${del}`);
		} finally {
			await stop();
		}
	});

	// 색이 add/del을 가른다 — 지우면 두 숫자가 같은 색이 되어 어느 쪽이
	// 추가인지 부호에만 의존하게 된다. happy-dom에는 캐스케이드가 없어
	// 유닛이 원리적으로 못 보는 계약이다.
	test("colors additions and deletions apart", async ({ page }) => {
		const { url, stop } = await launchViewer([]);
		try {
			await page.goto(url);
			await expect(page.locator("#change-add")).not.toBeEmpty();

			const colors = await page.evaluate(() => {
				const add = document.getElementById("change-add");
				const del = document.getElementById("change-del");
				if (!add || !del) throw new Error("totals nodes missing");
				return {
					add: getComputedStyle(add).color,
					del: getComputedStyle(del).color,
				};
			});
			// --vd-success(#3fb950) / #f85149 — 앱에 이미 있는 add·del 쌍.
			expect(colors.add).toBe("rgb(63, 185, 80)");
			expect(colors.del).toBe("rgb(248, 81, 73)");
		} finally {
			await stop();
		}
	});

	// 변경이 없으면 개수와 함께 자리를 통째로 비운다 — `+0 -0`이 남으면
	// 아무 말도 아닌 숫자가 툴바를 차지한다.
	test("says nothing when there is nothing to count", async ({ page }) => {
		const { url, stop } = await launchViewer([], { clean: true });
		try {
			await page.goto(url);
			await expect(page.locator("#status")).toBeEmpty();
			await expect(page.locator("#change-totals")).toBeEmpty();
		} finally {
			await stop();
		}
	});
});
