// 파일이 가상화 윈도우에 처음 들어올 때 마운트 프레임이 얼면 안 된다. 워커
// 경로는 plain을 동기로 그리고 색은 나중에 입힌다. 워커가 없으면 첫 진입이
// 파일 전체를 동기 토크나이즈한다(재진입 캐시로는 못 막는다 —
// retokenize-cache.e2e.ts).
//
// 측정이 두 단계인 이유:
// ① 스크롤만으로는 회귀가 갈리지 않는다. big.ts는 대형 파일이라 접힌 채
//    (토크나이즈 없이) 마운트되고, bulk 파일은 문법이 이미 데워져 있다 — 그래서
//    big.ts를 헤더로 펼쳐 잰다.
// ② 펼침과 스크롤을 한 루프에 섞지 않는다. 스크롤이 펼침 렌더가 끝나기 전에
//    big.ts를 오버스캔 밖으로 밀어 recycle한다.
import { expect, launchViewer, test } from "./fixtures/app.ts";

test("first entry into the overscan window must not freeze the frame", async ({
	page,
}) => {
	// bulk 12개는 2단계 스윕이 다른 파일들의 첫 진입을 훑을 길이를 만든다.
	const viewer = await launchViewer([], { bulkFiles: 12, bigFileLines: 4000 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		await page.mouse.move(2, 2);
		// 초기 렌더·하이라이트가 가라앉은 뒤에 잰다.
		await page.waitForTimeout(2000);

		// 1단계: 접힌 big.ts를 rAF 루프 안에서 펼쳐 첫 렌더 프레임을 잰다(스크롤
		// 없이 — 머리 주석 ②).
		const { expandGapMs, sawExpandedBig } = await page.evaluate(() => {
			const findBig = (): Element | undefined =>
				[...document.querySelectorAll("diffs-container")].find(
					(c) =>
						c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
						"src/big.ts",
				);
			return new Promise<{ expandGapMs: number; sawExpandedBig: boolean }>(
				(resolve) => {
					let maxGap = 0;
					let last = performance.now();
					let frames = 0;
					let clicked = false;
					let expanded = false;
					const tick = (): void => {
						const now = performance.now();
						maxGap = Math.max(maxGap, now - last);
						last = now;
						frames++;
						// 렌더는 클릭 다음 rAF에서 돈다(queueRender). 루프가 클릭 전부터
						// 돌아야 그 프레임을 잡는다 — 클릭 뒤에 루프를 시작하면 조용히
						// 빈 통과가 된다.
						if (frames === 2 && !clicked) {
							clicked = true;
							const header = findBig()?.shadowRoot?.querySelector(
								"[data-diffs-header]",
							);
							header?.dispatchEvent(
								new MouseEvent("click", { bubbles: true, composed: true }),
							);
						}
						if (clicked && !expanded) {
							const len =
								findBig()?.shadowRoot?.querySelector("pre")?.textContent
									?.length ?? 0;
							if (len > 1000) expanded = true;
						}
						if (frames < 30) {
							requestAnimationFrame(tick);
						} else {
							resolve({ expandGapMs: maxGap, sawExpandedBig: expanded });
						}
					};
					requestAnimationFrame(tick);
				},
			);
		});

		// 빈 통과 방지: 클릭이 씹혀 접힌 채로 남으면 갭이 작아 그냥 통과한다.
		expect(sawExpandedBig).toBe(true);

		// 워커 경로의 plain 렌더는 수십 ms, 동기 토크나이즈는 수백 ms 이상이다 —
		// 그 사이의 상한.
		expect(expandGapMs).toBeLessThan(150);

		// 2단계: 휠로 문서를 훑어 bulk 파일들의 첫 진입을 잰다. 스윕(STEPS ×
		// STEP_PX)은 문서 끝에 닿지 않아야 한다 — 아래 정확한 scrollTop 단언의
		// 전제다.
		//
		// 스크롤은 휠로 한다. 프레임 안에서 scrollTop을 대입하면 CI의 Linux
		// 헤드리스 Chrome이 컴포지터 커밋 대기에서 멈출 수 있다(e2e.md). 그 멈춤은
		// 아래 색 폴이 끝내 false인 모양으로도 나온다.
		//
		// 상한이 1단계보다 느슨한 이유: 휠 스윕은 최악 프레임 간격이 더 크다.
		// 회귀를 가르는 건 1단계이고(머리 주석 ①), 여기는 첫 진입이 프레임을
		// 수백 ms 얼리지 않는다는 넓은 가드다.
		await page.evaluate(() => {
			const w = window as unknown as {
				__gaps: { max: number; frames: number; stop: boolean };
			};
			w.__gaps = { max: 0, frames: 0, stop: false };
			let last = performance.now();
			const tick = (): void => {
				const now = performance.now();
				w.__gaps.max = Math.max(w.__gaps.max, now - last);
				last = now;
				w.__gaps.frames++;
				if (!w.__gaps.stop) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		const box = await page.locator("#diff").boundingBox();
		if (!box) throw new Error("#diff has no box");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		const STEPS = 240;
		const STEP_PX = 900;
		for (let i = 0; i < STEPS; i++) {
			await page.mouse.wheel(0, STEP_PX);
			await page.waitForTimeout(16);
		}
		const { scrollGapMs, scrolledTo } = await page.evaluate(() => {
			const w = window as unknown as {
				__gaps: { max: number; frames: number; stop: boolean };
			};
			w.__gaps.stop = true;
			return {
				scrollGapMs: w.__gaps.max,
				scrolledTo: (document.getElementById("diff") as HTMLElement).scrollTop,
			};
		});
		// 빈 통과 방지: 휠이 씹히면 파일이 새로 진입하지 않아 갭이 작게 나온다 —
		// 느슨한 하한이 아니라 정확한 값을 단언한다.
		expect(scrolledTo).toBe(STEPS * STEP_PX);

		const mounted = await page.evaluate(
			() => document.querySelectorAll("diffs-container").length,
		);
		expect(mounted).toBeGreaterThan(0);
		expect(scrollGapMs).toBeLessThan(300);

		// plain → 색 전이가 결국 일어나는지 보는 liveness 폴이다(예산 단언은 위의
		// 두 상한).
		await expect
			.poll(
				() =>
					page.evaluate(() =>
						[...document.querySelectorAll("diffs-container")].some(
							(c) =>
								c.shadowRoot
									?.querySelector("pre")
									?.querySelector("span[style]") != null,
						),
					),
				// 테스트 타임아웃(playwright.config.ts)과 짝인 값이다 — 앞 구간과 이
				// 폴이 그 안에 들어야 폴의 실패 메시지와 finally의 viewer.stop()
				// stderr가 남는다. 한쪽을 바꾸면 다른 쪽도 다시 계산한다.
				{ timeout: 25_000 },
			)
			.toBe(true);
	} finally {
		await viewer.stop();
	}
});

test("viewer renders highlighted output even when the worker script fails to load", async ({
	page,
}) => {
	// 워커 로드를 막아 워치독(recoverFromWorkerLoadFailure)이 워커 없이
	// 복구하는지 본다(viewer.md).
	await page.route("**/worker.js", (route) => route.abort());
	const viewer = await launchViewer([]);
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect
			.poll(
				() =>
					page.evaluate(() =>
						[...document.querySelectorAll("diffs-container")].some(
							(c) =>
								(c.shadowRoot?.textContent ?? "").includes("hello, world") &&
								c.shadowRoot
									?.querySelector("pre")
									?.querySelector("span[style]") != null,
						),
					),
				{ timeout: 20_000 },
			)
			.toBe(true);
	} finally {
		await viewer.stop();
	}
});
