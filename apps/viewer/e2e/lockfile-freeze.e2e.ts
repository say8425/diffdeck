// vendored 예외 2와 뷰어의 하이라이트 상한(tokenizeMaxLength)의 회귀망
// (vendored-packages.md). 메인 스레드 하이라이터 경로에서 재려고 worker.js를
// 막는다(e2e.md).
import type { Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";

let blockedWorkerLoads = 0;

test.beforeEach(async ({ page }) => {
	blockedWorkerLoads = 0;
	await page.route("**/worker.js", (route) => {
		blockedWorkerLoads++;
		return route.abort();
	});
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
	// 라우트가 빗나가면 워커 경로로 돌아가 빈 통과가 된다.
	expect(blockedWorkerLoads).toBeGreaterThan(0);
};

const waitForFileHighlight = async (
	page: Page,
	path: string,
): Promise<void> => {
	await expect
		.poll(
			() =>
				page.evaluate(
					(target) =>
						[...document.querySelectorAll("diffs-container")]
							.find(
								(el) =>
									el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
									target,
							)
							?.shadowRoot?.querySelector("pre span[style]") != null,
					path,
				),
			{ timeout: 20_000 },
		)
		.toBe(true);
};

type Action = "jump-to-bottom" | "expand-lockfile";

// 동작은 측정 창 안에서 실행해야 그 동작이 낳은 정지가 잡힌다.
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
): Promise<{
	mounted: boolean;
	hasHeader: boolean;
	height: number;
	preTextLen: number;
}> =>
	page.evaluate(() => {
		const lockfile = [...document.querySelectorAll("diffs-container")].find(
			(el) =>
				el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
				"pnpm-lock.yaml",
		);
		return {
			mounted: lockfile != null,
			hasHeader:
				lockfile?.shadowRoot?.querySelector("[data-diffs-header]") != null,
			height: Math.round(lockfile?.getBoundingClientRect().height ?? 0),
			preTextLen:
				lockfile?.shadowRoot?.querySelector("pre")?.textContent?.length ?? 0,
		};
	});

const mountLockfileAtBottom = async (page: Page): Promise<void> => {
	const box = await page.locator("#diff").boundingBox();
	if (!box) throw new Error("#diff not visible");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await expect
		.poll(async () => {
			await page.mouse.wheel(0, 100_000);
			return (await lockfileState(page)).hasHeader;
		})
		.toBe(true);
};

test("mounting a collapsed highlightable lockfile must not freeze the frame", async ({
	page,
}) => {
	// 하이라이트 상한 아래여야 하고(e2e.md), yaml 문법이 먼저 붙어 있어야 한다 —
	// 없으면 sync 경로가 어차피 plain으로 그려 그 경로의 회귀를 가르지 못한다.
	const viewer = await launchViewer([], {
		bulkFiles: 2,
		lockfileLines: 15_000,
		yamlFile: true,
	});
	try {
		await page.goto(viewer.url);
		await waitForMainThreadHighlight(page);
		await waitForFileHighlight(page, ".github/ci.yaml");

		const gapMs = await maxFrameGapDuring(page, "jump-to-bottom");

		// 안 그려서 통과하지 않도록 lockfile 헤더가 실제로 마운트됐는지 본다.
		expect(await lockfileState(page)).toMatchObject({
			mounted: true,
			hasHeader: true,
		});
		// 점프는 이웃 파일도 메인 스레드에서 하이라이트한다. 상한은 그 정상 비용과
		// lockfile 전체 토크나이즈(회귀) 사이에 둔다.
		expect(gapMs).toBeLessThan(1000);
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
		expect(state.mounted).toBe(true);
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
	// 찍는다. 행은 곧 자가복구되므로 판별자는 console.error다. yaml 문법이 붙어
	// 있으면 펼침이 표식 없이도 다시 그려 판별하지 못하므로 yaml 파일을 두지 않는다.
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
