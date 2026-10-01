// 자동 접힘은 파일 길이가 아니라 변경량으로 판정한다(viewer.md "변경량 세기").
// 세 방향을 이 파일에서 함께 지킨다 — retokenize-cache·lockfile-freeze 스펙은
// 접힘 상태를 단언하지 않는다.
import { expect, hasCode, launchViewer, test } from "./fixtures/app.ts";

// ① 긴 파일의 몇 줄만 바꾼다 — 파일 길이로 세면 접히고, 변경량으로 세면
// 안 접힌다.
test("a long file whose diff is small must not start collapsed", async ({
	page,
}) => {
	const viewer = await launchViewer([], { longFileSmallEdit: true });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect
			.poll(() => hasCode(page, "src/long.ts"), { timeout: 20_000 })
			.toBe(true);
		await expect(page.locator('[data-fold="src/long.ts"]')).toHaveAttribute(
			"aria-label",
			"Collapse file",
		);
	} finally {
		await viewer.stop();
	}
});

// ② 800줄 전량 재작성은 변경량으로도 임계값을 넘는다. ①만으로는 변경량이 0으로
// 퇴화해도 초록이다.
test("a diff larger than the threshold still starts collapsed", async ({
	page,
}) => {
	const viewer = await launchViewer([], { bigFileLines: 800 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator('[data-fold="src/big.ts"]')).toHaveAttribute(
			"aria-label",
			"Expand file",
			{ timeout: 20_000 },
		);
		expect(await hasCode(page, "src/big.ts")).toBe(false);
	} finally {
		await viewer.stop();
	}
});

// ③ 1,000줄 lockfile의 변경량은 임계값 한참 아래라 크기 규칙으로는 접히지
// 않는다 — 접히는 근거는 이름 규칙(LOCKFILE_NAMES)뿐이다.
test("a lockfile collapses by name even when its diff is small", async ({
	page,
}) => {
	const viewer = await launchViewer([], { lockfileLines: 1000 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator('[data-fold="pnpm-lock.yaml"]')).toHaveAttribute(
			"aria-label",
			"Expand file",
			{ timeout: 20_000 },
		);
		expect(await hasCode(page, "pnpm-lock.yaml")).toBe(false);
	} finally {
		await viewer.stop();
	}
});
