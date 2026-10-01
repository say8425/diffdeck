// vendored 예외 2와 뷰어의 하이라이트 상한(tokenizeMaxLength)의 회귀망. 메인
// 스레드 하이라이터 경로에서 재려고 worker.js를 막는다(e2e.md).
import type { Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";

test.beforeEach(async ({ page }) => {
	await page.route("**/worker.js", (route) => route.abort());
});

// 워커가 없으니 하이라이트 색은 메인 스레드 하이라이터가 칠한 것이다.
const waitForMainThreadHighlight = async (page: Page): Promise<void> => {
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
		timeout: 15_000,
	});
	await expect
		.poll(
			() =>
				page.evaluate(() =>
					[...document.querySelectorAll("diffs-container")].some(
						(c) => c.shadowRoot?.querySelector("pre span[style]") != null,
					),
				),
			{ timeout: 20_000 },
		)
		.toBe(true);
};

type Action = "jump-to-bottom" | "expand-lockfile";

// 동작은 측정 창(120프레임) 안에서 실행해야 그 동작이 낳은 정지가 잡힌다.
const perform = (
	page: Page,
	action: Action,
	measure: boolean,
): Promise<number> =>
	page.evaluate(
		({ kind, timed }) =>
			new Promise<number>((resolve) => {
				const run = (): void => {
					if (kind === "jump-to-bottom") {
						const scroller = document.getElementById("diff") as HTMLElement;
						scroller.scrollTop = scroller.scrollHeight;
						return;
					}
					const lockfile = [
						...document.querySelectorAll("diffs-container"),
					].find(
						(el) =>
							el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
							"pnpm-lock.yaml",
					);
					lockfile?.shadowRoot
						?.querySelector("[data-diffs-header]")
						?.dispatchEvent(
							new MouseEvent("click", { bubbles: true, composed: true }),
						);
				};
				if (!timed) {
					run();
					resolve(0);
					return;
				}
				let maxGap = 0;
				let last = performance.now();
				let frames = 0;
				const tick = (): void => {
					const now = performance.now();
					maxGap = Math.max(maxGap, now - last);
					last = now;
					frames++;
					if (frames < 120) requestAnimationFrame(tick);
					else resolve(maxGap);
				};
				requestAnimationFrame(tick);
				run();
			}),
		{ kind: action, timed: measure },
	);

const maxFrameGapDuring = (page: Page, action: Action): Promise<number> =>
	perform(page, action, true);

const runAction = async (page: Page, action: Action): Promise<void> => {
	await perform(page, action, false);
};

const lockfileState = (
	page: Page,
): Promise<{ hasHeader: boolean; height: number; preTextLen: number }> =>
	page.evaluate(() => {
		const lockfile = [...document.querySelectorAll("diffs-container")].find(
			(el) =>
				el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
				"pnpm-lock.yaml",
		);
		return {
			hasHeader:
				lockfile?.shadowRoot?.querySelector("[data-diffs-header]") != null,
			height: Math.round(lockfile?.getBoundingClientRect().height ?? 0),
			preTextLen:
				lockfile?.shadowRoot?.querySelector("pre")?.textContent?.length ?? 0,
		};
	});

const mountLockfileAtBottom = async (page: Page): Promise<void> => {
	await runAction(page, "jump-to-bottom");
	await expect
		.poll(async () => (await lockfileState(page)).hasHeader)
		.toBe(true);
};

test("mounting a collapsed highlightable lockfile must not freeze the frame", async ({
	page,
}) => {
	// 하이라이트 상한(20k줄) 아래여야 예외 2를 판별한다(e2e.md).
	const viewer = await launchViewer([], {
		bulkFiles: 2,
		lockfileLines: 15_000,
	});
	try {
		await page.goto(viewer.url);
		await waitForMainThreadHighlight(page);

		const gapMs = await maxFrameGapDuring(page, "jump-to-bottom");

		// 안 그려서 통과하지 않도록 lockfile 헤더가 실제로 마운트됐는지 본다.
		expect((await lockfileState(page)).hasHeader).toBe(true);
		// 정상 프레임(~16ms)에 CI 여유를 크게 둔 상한 — 동기 토크나이즈는 초 단위라
		// 그래도 갈린다.
		expect(gapMs).toBeLessThan(300);
	} finally {
		await viewer.stop();
	}
});

test("expanding a lockfile over the highlight cutoff must not freeze the frame", async ({
	page,
}) => {
	const viewer = await launchViewer([], {
		bulkFiles: 2,
		lockfileLines: 30_000,
	});
	try {
		await page.goto(viewer.url);
		await waitForMainThreadHighlight(page);
		await mountLockfileAtBottom(page);

		const gapMs = await maxFrameGapDuring(page, "expand-lockfile");

		// 하이라이트 포기가 "안 그림"으로 새지 않도록 코드 행이 그려졌는지 본다.
		const state = await lockfileState(page);
		expect(state.height).toBeGreaterThan(200);
		expect(state.preTextLen).toBeGreaterThan(1000);
		expect(gapMs).toBeLessThan(1500);
	} finally {
		await viewer.stop();
	}
});

test("expanding a collapsed highlightable lockfile renders without an engine error", async ({
	page,
}) => {
	// 빈 윈도우의 zero-line 결과를 펼침 렌더가 재사용하면 엔진이 console.error를
	// 찍는다. 행은 곧 자가복구되므로 판별자는 console.error다.
	const viewer = await launchViewer([], { bulkFiles: 2, lockfileLines: 8000 });
	try {
		await page.goto(viewer.url);
		await waitForMainThreadHighlight(page);
		// 막힌 워커 로드의 콘솔 오류는 세지 않는다.
		const consoleErrors: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "error") consoleErrors.push(msg.text());
		});
		await mountLockfileAtBottom(page);

		await runAction(page, "expand-lockfile");

		await expect
			.poll(async () => (await lockfileState(page)).preTextLen, {
				timeout: 15_000,
			})
			.toBeGreaterThan(1000);
		expect(
			consoleErrors.filter((t) => /something is wrong|Error/i.test(t)),
		).toEqual([]);
	} finally {
		await viewer.stop();
	}
});
