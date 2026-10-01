// 피커 목록이 max-height를 넘으면 행이 눌리지 않고 목록이 스크롤돼야 한다.
// 세로 flex 목록의 기본 flex-shrink 때문에 두 줄(PR) 행이 min-height까지 눌려
// 다음 행과 겹친 적이 있다. 행이 적은 픽스처에서는 넘치지 않아 드러나지 않는다.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const BRANCHES = Array.from({ length: 10 }, (_, i) => `feat/b${i}`);

test("행이 많아 목록이 넘쳐도 PR 줄이 있는 행은 눌리지 않고 목록이 스크롤된다", async ({
	page,
}) => {
	// 실제 `gh`는 GitHub에 가므로 `pr list`에만 고정 JSON을 답하는 가짜를 둔다.
	const ghDir = mkdtempSync(join(tmpdir(), "dd-e2e-gh-"));
	const json = join(ghDir, "prs.json");
	writeFileSync(
		json,
		JSON.stringify(
			BRANCHES.map((name, i) => ({
				number: 100 + i,
				title: `feat: ${name} 작업`,
				headRefName: name,
				state: "OPEN",
				isDraft: false,
				url: `https://github.com/o/r/pull/${100 + i}`,
				isCrossRepository: false,
			})),
		),
	);
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
		{
			PATH: `${ghDir}:${process.env.PATH ?? ""}`,
		},
	);
	try {
		await page.goto(url);
		await page.locator("#ref-picker-btn").click();
		const list = page.locator("#ref-picker-list");
		await expect(list.locator(".ref-row-pr")).toHaveCount(BRANCHES.length);

		const layout = await list.evaluate((el) => ({
			scrolls: el.scrollHeight > el.clientHeight,
			rows: [...el.querySelectorAll(".ref-row")].map((row) => {
				const r = row.getBoundingClientRect();
				return {
					top: r.top,
					bottom: r.bottom,
					height: r.height,
					hasPr: row.querySelector(".ref-row-pr") !== null,
					overflow: row.scrollHeight - row.clientHeight,
				};
			}),
		}));
		expect(layout.scrolls).toBe(true);
		for (const row of layout.rows) expect(row.overflow).toBeLessThanOrEqual(0);
		const prHeights = layout.rows.filter((r) => r.hasPr).map((r) => r.height);
		const plainHeights = layout.rows
			.filter((r) => !r.hasPr)
			.map((r) => r.height);
		expect(Math.min(...prHeights)).toBeGreaterThan(Math.max(...plainHeights));
		for (let i = 1; i < layout.rows.length; i++) {
			expect(layout.rows[i].top).toBeGreaterThanOrEqual(
				layout.rows[i - 1].bottom - 0.5,
			);
		}
	} finally {
		await stop();
		rmSync(ghDir, { recursive: true, force: true });
	}
});
