// vendored 예외 2(빈 렌더 윈도우를 plain-text로)의 회귀망(vendored-packages.md).
// 프리징은 최하단으로 점프한 직후의 최대 프레임 간격으로 잰다.
import { expect, launchViewer, test } from "./fixtures/app.ts";

test("mounting a huge collapsed lockfile at the bottom must not freeze the frame", async ({
	page,
}) => {
	const viewer = await launchViewer([], {
		bulkFiles: 2,
		lockfileLines: 30_000,
	});
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		await expect(page.locator("diffs-container").first()).toBeVisible();

		const maxFrameGapMs = await page.evaluate(
			() =>
				new Promise<number>((resolve) => {
					const scroller = document.getElementById("diff") as HTMLElement;
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
					scroller.scrollTop = scroller.scrollHeight;
				}),
		);

		// 안 그려서 통과하지 않도록 lockfile 헤더가 실제로 마운트됐는지 본다.
		const lockfileState = await page.evaluate(() => {
			const container = [...document.querySelectorAll("diffs-container")].find(
				(el) =>
					el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
					"pnpm-lock.yaml",
			);
			return container
				? {
						hasHeader:
							container.shadowRoot?.querySelector("[data-diffs-header]") !=
							null,
					}
				: null;
		});
		expect(lockfileState).toEqual({ hasHeader: true });

		// 정상 프레임(~16ms)에 CI 여유를 크게 둔 상한 — 동기 토크나이즈는 수백 ms
		// 이상이라 그래도 갈린다.
		expect(maxFrameGapMs).toBeLessThan(300);

		// 30k줄은 뷰어의 tokenizeMaxLength(20k)를 넘어 펼치면 plain text로 그린다 —
		// 전체 토크나이즈(수 초)와 갈리는 상한을 둔다.
		const expandGapMs = await page.evaluate(
			() =>
				new Promise<number>((resolve) => {
					const container = [
						...document.querySelectorAll("diffs-container"),
					].find(
						(el) =>
							el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
							"pnpm-lock.yaml",
					);
					const header = container?.shadowRoot?.querySelector(
						"[data-diffs-header]",
					);
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
					header?.dispatchEvent(
						new MouseEvent("click", { bubbles: true, composed: true }),
					);
				}),
		);
		// 하이라이트 포기가 "안 그림"으로 새지 않도록 펼친 행이 그려졌는지 본다.
		const expanded = await page.evaluate(() => {
			const container = [...document.querySelectorAll("diffs-container")].find(
				(el) =>
					el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
					"pnpm-lock.yaml",
			);
			const pre = container?.shadowRoot?.querySelector("pre");
			return {
				height: Math.round(container?.getBoundingClientRect().height ?? 0),
				preChildren: pre?.childElementCount ?? 0,
				preTextLen: pre?.textContent?.length ?? 0,
			};
		});
		// 헤더만이 아니라 코드 행이 그려진 높이·내용이어야 한다.
		expect(expanded.height).toBeGreaterThan(200);
		expect(expanded.preTextLen).toBeGreaterThan(1000);
		expect(expandGapMs).toBeLessThan(1500);
	} finally {
		await viewer.stop();
	}
});

test("expanding a sub-cutoff (highlightable) lockfile renders without an engine error", async ({
	page,
}) => {
	// 8k줄은 tokenizeMaxLength(20k) 아래라 하이라이트 대상이다. 빈 윈도우의
	// zero-line 결과를 펼침 렌더가 재사용하면 엔진이 console.error를 찍는다 —
	// 행은 곧 자가복구되므로 판별자는 console.error다.
	const viewer = await launchViewer([], { bulkFiles: 2, lockfileLines: 8000 });
	const consoleErrors: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		await expect(page.locator("diffs-container").first()).toBeVisible();

		await page.evaluate(() => {
			const scroller = document.getElementById("diff") as HTMLElement;
			scroller.scrollTop = scroller.scrollHeight;
		});
		const expandLockfile = (): Promise<boolean> =>
			page.evaluate(() => {
				const container = [
					...document.querySelectorAll("diffs-container"),
				].find(
					(el) =>
						el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
						"pnpm-lock.yaml",
				);
				const header = container?.shadowRoot?.querySelector(
					"[data-diffs-header]",
				);
				if (!header) return false;
				header.dispatchEvent(
					new MouseEvent("click", { bubbles: true, composed: true }),
				);
				return true;
			});
		await expect.poll(expandLockfile, { timeout: 15_000 }).toBe(true);

		await expect
			.poll(
				() =>
					page.evaluate(() => {
						const container = [
							...document.querySelectorAll("diffs-container"),
						].find(
							(el) =>
								el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
								"pnpm-lock.yaml",
						);
						return (
							container?.shadowRoot?.querySelector("pre")?.textContent
								?.length ?? 0
						);
					}),
				{ timeout: 15_000 },
			)
			.toBeGreaterThan(1000);

		expect(
			consoleErrors.filter((t) => /something is wrong|Error/i.test(t)),
		).toEqual([]);
	} finally {
		await viewer.stop();
	}
});
