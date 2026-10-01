// 행이 적은 기존 픽스처로는 목록이 max-height를 넘지 않아, 넘칠 때 자식이
// 눌리는 결함이 드러나지 않는다. PR이 붙은 브랜치로 목록을 넘치게 한다.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const BRANCHES = Array.from({ length: 10 }, (_, i) => `feat/b${i}`);

const PRS = BRANCHES.map((name, i) => ({
	number: 100 + i,
	title: `feat: ${name} 작업`,
	headRefName: name,
	state: "OPEN",
	isDraft: false,
	url: `https://github.com/o/r/pull/${100 + i}`,
	isCrossRepository: false,
}));

test("목록이 넘쳐도 행과 구분선은 눌리지 않고 목록이 스크롤된다", async ({
	page,
}) => {
	const ghDir = mkdtempSync(join(tmpdir(), "dd-e2e-gh-"));
	try {
		const json = join(ghDir, "prs.json");
		writeFileSync(json, JSON.stringify(PRS));
		const gh = join(ghDir, "gh");
		writeFileSync(
			gh,
			`#!/bin/sh\nif [ "$1" = "pr" ] && [ "$2" = "list" ]; then cat "${json}"; exit 0; fi\nexit 1\n`,
		);
		chmodSync(gh, 0o755);
		const { url, stop } = await launchViewer(
			[],
			{ branches: BRANCHES },
			undefined,
			{ PATH: `${ghDir}:${process.env.PATH ?? ""}` },
		);
		try {
			// head가 브랜치면 워크트리 구역도 서서, 두 구역 사이에 구분선이 생긴다.
			await page.goto(`${url}&head=${BRANCHES[0]}`);
			await page.locator("#ref-picker-btn").click();
			const list = page.locator("#ref-picker-list");
			await expect(list.locator(".ref-row-pr")).toHaveCount(BRANCHES.length);
			await expect(list.locator(".ref-divider")).toHaveCount(1);

			const layout = await list.evaluate((el) => {
				const rows = [...el.querySelectorAll(".ref-row")].map((row) => ({
					name: row.textContent?.trim().slice(0, 24),
					height: row.getBoundingClientRect().height,
					hasPr: row.querySelector(".ref-row-pr") !== null,
					overflow: row.scrollHeight - row.clientHeight,
				}));
				return {
					scrolls: el.scrollHeight > el.clientHeight,
					dividerHeight: el
						.querySelector(".ref-divider")
						?.getBoundingClientRect().height,
					squeezed: rows.filter((r) => r.overflow > 0),
					prHeights: rows.filter((r) => r.hasPr).map((r) => r.height),
					plainHeights: rows.filter((r) => !r.hasPr).map((r) => r.height),
				};
			});
			expect(layout.scrolls).toBe(true);
			expect(layout.squeezed).toEqual([]);
			expect(layout.dividerHeight).toBe(1);
			expect(layout.plainHeights.length).toBeGreaterThan(0);
			expect(Math.min(...layout.prHeights)).toBeGreaterThan(
				Math.max(...layout.plainHeights),
			);
		} finally {
			await stop();
		}
	} finally {
		rmSync(ghDir, { recursive: true, force: true });
	}
});
