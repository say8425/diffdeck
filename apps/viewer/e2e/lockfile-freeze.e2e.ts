// 대형 collapsed lockfile이 최하단에서 마운트될 때 메인 스레드가 얼면 안 된다.
//
// 뷰어는 lockfile을 첫 등장에 자동 접지만(collapsed), 엔진의 하이라이트
// 렌더는 렌더 범위를 무시하고 old/new 전체를 동기 토크나이즈한다
// (renderDiffWithHighlighter.ts:53-60 — "범위 하이라이트는 문법을 깨뜨릴 수
// 있다"라 highlighted 렌더에서 startingLine/totalLines를 덮어씀). 수만 줄
// lockfile이면 헤더 한 줄 보여주자고 수백 ms~수 초를 태우는 프리징이 된다.
// 수정: DiffHunksRenderer.renderDiff가 빈 윈도우(totalLines 0 = collapsed)를
// plain-text + zero-range로 렌더해 토크나이즈 없이 헤더만 그린다.
//
// 프로브: 최하단으로 점프한 뒤 120 rAF 동안 최대 프레임 간격을 잰다 —
// 프리징이 있으면 스크롤 직후 엔진 렌더가 그 프레임을 수백 ms 붙잡는다.
import { expect, launchViewer, test } from "./fixtures/app.ts";

test("mounting a huge collapsed lockfile at the bottom must not freeze the frame", async ({
	page,
}) => {
	// 30k줄 lockfile: 엔진의 massive 컷오프(100k줄) 아래라 하이라이트 대상이
	// 되는, 현실적인 대형 리포 크기 (실사례: engagement-frontend 52k줄).
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

		// lockfile이 실제로 최하단에 collapsed 헤더로 마운트됐는지 — 안 그려서
		// 통과하는 가짜 성공 방지.
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

		// 60fps 기준 정상 프레임은 ~16ms. CI 여유를 크게 잡아도, 수만 줄 동기
		// 토크나이즈(수백 ms~수 초)와는 차원이 다른 300ms를 상한으로 둔다.
		expect(maxFrameGapMs).toBeLessThan(300);

		// 펼치기: 헤더 클릭으로 확장해도 얼면 안 된다 — 뷰어의
		// tokenizeMaxLength(20k줄) 아래로 하이라이트를 포기하고 plain text로
		// 렌더하는 경로. 전체 토크나이즈(수 초)와 구분되는 상한을 둔다.
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
		// 펼친 내용(diff 행)이 실제로 렌더됐는지 — 하이라이트 포기가 "안 그림"
		// 으로 새지 않게 고정한다.
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
		// 헤더(~44px)만이 아니라 실제 코드 행이 렌더된 높이/내용이어야 한다.
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
	// 8k줄: 뷰어의 tokenizeMaxLength(20k) "아래"라 하이라이트 대상인 lockfile.
	// collapsed 동안 empty-window 렌더는 lang 'text'로만 돌므로 yaml 문법이
	// 로드되지 않은 채 펼침이 일어난다 — 이때 빈 윈도우에서 캐시된 zero-line
	// 풀을 확장 렌더가 재사용하면 processDiffResult가 throw하고 엔진 catch가
	// console.error + 에러 박스를 띄운다(비동기 하이라이트가 곧 자가복구해
	// 행은 결국 보이므로, 판별자는 그 순간의 console.error다).
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

		// 펼친 행이 실제로 나타난다 (plain 이든 highlighted 든).
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

		// 엔진 렌더 오류가 한 번도 찍히지 않아야 한다.
		expect(
			consoleErrors.filter((t) => /something is wrong|Error/i.test(t)),
		).toEqual([]);
	} finally {
		await viewer.stop();
	}
});
