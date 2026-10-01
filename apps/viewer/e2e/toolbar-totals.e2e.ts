// 기대값은 하드코딩하지 않고 스펙 안에서 git으로 계산한다 — 클라이언트의
// 재-diff가 git과 갈리면 잡힌다.
import { spawnSync } from "node:child_process";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const capture = (dir: string, args: string[]): string => {
	const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
	}
	return r.stdout;
};

// 바이너리는 numstat에 `-`로 나와 뺀다.
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

			const afterStatus = await page.evaluate(
				() => document.getElementById("status")?.nextElementSibling?.id ?? null,
			);
			expect(afterStatus).toBe("change-totals");

			// toHaveText는 공백을 정규화해 조각 사이에 낀 공백 텍스트 노드를 못 잡는다.
			expect(
				await page.locator("#change-totals").evaluate((el) => el.textContent),
			).toBe(`+${add} -${del}`);
		} finally {
			await stop();
		}
	});

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
			// `--vd-success`(#3fb950)와 #f85149 — 앱의 add·del 색.
			expect(colors.add).toBe("rgb(63, 185, 80)");
			expect(colors.del).toBe("rgb(248, 81, 73)");
		} finally {
			await stop();
		}
	});

	test("clears the totals when a render lands with nothing to count", async ({
		page,
	}) => {
		// 숫자가 쓰인 뒤 사라지는 전이를 본다 — clean 리포로 띄우면 처음부터 비어
		// 있어 비우는 배선을 지워도 통과한다.
		const { url, repoDir, stop } = await launchViewer([]);
		try {
			await page.goto(url);
			await expect(page.locator("#change-add")).not.toBeEmpty();

			capture(repoDir, ["checkout", "--", "."]);
			await page.evaluate(() => window.dispatchEvent(new Event("focus")));

			await expect(page.locator("#status")).toBeEmpty();
			await expect(page.locator("#change-totals")).toBeEmpty();
		} finally {
			await stop();
		}
	});
});
