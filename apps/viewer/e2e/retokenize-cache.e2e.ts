// 오버스캔을 벗어났다 재진입하는 파일이 전체 재토크나이즈로 프레임을 얼리면
// 안 된다.
//
// CodeView는 파일이 오버스캔 윈도우를 벗어나면 releaseRenderedItem →
// FileDiff.cleanUp(true) → DiffHunksRenderer.recycle()로 인스턴스를 재활용
// 하는데, recycle()이 토크나이즈된 AST(renderCache)까지 폐기하면 재진입
// 마운트 프레임에서 파일 전체(양쪽)를 메인 스레드에서 동기 재토크나이즈한다
// (뷰어는 workerManager를 넘기지 않으므로 항상 non-worker 경로). 4천 줄
// 파일이면 수백 ms 프리징 — 스크롤을 되돌릴 때마다 반복된다. 수정: recycle이
// 하이라이트 완료된 캐시를 보존한다 (스테일은 renderDiff의 diff/options
// 동등성 검증이 자동 무효화 — watch 가드는 이 파일의 두 번째 테스트).
//
// 프로브: big.ts가 하이라이트된 상태에서 최하단으로 점프해 언마운트(=recycle)
// 시킨 뒤, 원위치로 점프해 재마운트되는 120 rAF 동안 최대 프레임 간격을 잰다.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, launchViewer, test } from "./fixtures/app.ts";

test("re-entering a highlighted file must not freeze the frame with a re-tokenize", async ({
	page,
}) => {
	// 4,000줄 × 전량 재작성 = 양쪽 8,000줄 토크나이즈 — 재토크나이즈가 있으면
	// 프레임 간격 수백 ms로 임계(250ms)를 확실히 넘고, 없으면 캐시 렌더는
	// 수십 ms라 확실히 안 넘는 크기. bulk 12개는 big.ts를 오버스캔(1000px)
	// 밖으로 밀어낼 스크롤 거리를 만든다.
	const viewer = await launchViewer([], { bulkFiles: 12, bigFileLines: 4000 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		await expect(page.locator("diffs-container").first()).toBeVisible();
		// 포인터를 패널 밖에 둬 :hover 스타일 간섭 배제 (header-mount 패턴).
		await page.mouse.move(2, 2);

		// big.ts 컨테이너 탐색은 lockfile-freeze.e2e.ts처럼 각 evaluate 안에
		// 인라인한다 (evaluate 콜백은 브라우저에서 실행되므로 바깥 함수를 참조할
		// 수 없다).

		// big.ts는 4,000줄 × 전량 재작성(변경 8,000줄)이라 largeFile.ts의
		// LARGE_FILE_LINE_THRESHOLD(1,500줄)를 넘어 lockfile과 동일하게 첫
		// 등장 시 collapsed로 마운트된다(main.ts의 isLargeFile). collapsed
		// 상태는 emptyWindow(zero-line, highlighted:false) 렌더라 recycle이
		// 보존할 캐시가 없으므로, lockfile-freeze.e2e.ts의 두 번째 테스트처럼
		// 헤더를 클릭해 펼쳐 실제 하이라이트를 트리거해야 한다.
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							[...document.querySelectorAll("diffs-container")].find(
								(c) =>
									c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
									"src/big.ts",
							) != null,
					),
				{ timeout: 20_000 },
			)
			.toBe(true);
		const expandBigFile = (): Promise<boolean> =>
			page.evaluate(() => {
				const el = [...document.querySelectorAll("diffs-container")].find(
					(c) =>
						c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
						"src/big.ts",
				);
				const header = el?.shadowRoot?.querySelector("[data-diffs-header]");
				if (!header) return false;
				header.dispatchEvent(
					new MouseEvent("click", { bubbles: true, composed: true }),
				);
				return true;
			});
		await expect.poll(expandBigFile).toBe(true);

		// big.ts가 펼쳐져 하이라이트(스타일 있는 span)까지 끝나기를 기다린다 —
		// 이 시점의 renderCache가 보존 대상이다.
		await expect
			.poll(
				() =>
					page.evaluate(() => {
						const el = [...document.querySelectorAll("diffs-container")].find(
							(c) =>
								c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
								"src/big.ts",
						);
						return (
							el?.shadowRoot
								?.querySelector("pre")
								?.querySelector("span[style]") != null
						);
					}),
				{ timeout: 20_000 },
			)
			.toBe(true);
		// 재진입 점프의 목적지로 쓸 big.ts의 문서 내 위치를 기록한다.
		const bigTop = await page.evaluate(() => {
			const el = [...document.querySelectorAll("diffs-container")].find(
				(c) =>
					c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
					"src/big.ts",
			) as HTMLElement;
			const scroller = document.getElementById("diff") as HTMLElement;
			return (
				el.getBoundingClientRect().top -
				scroller.getBoundingClientRect().top +
				scroller.scrollTop
			);
		});

		// 최하단으로 점프 → big.ts가 오버스캔을 벗어나 언마운트(recycle)된다.
		await page.evaluate(() => {
			const scroller = document.getElementById("diff") as HTMLElement;
			scroller.scrollTop = scroller.scrollHeight;
		});
		await expect
			.poll(
				() =>
					page.evaluate(() =>
						[...document.querySelectorAll("diffs-container")].every(
							(c) =>
								c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold !==
								"src/big.ts",
						),
					),
				{ timeout: 15_000 },
			)
			.toBe(true);
		// 하단 파일들의 최초 토크나이즈가 측정을 오염시키지 않게 settle.
		await page.waitForTimeout(1500);

		// 원위치로 점프해 재마운트 — 이 구간의 최대 프레임 간격이 판별자.
		const reentryMaxGapMs = await page.evaluate(
			(top) =>
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
					scroller.scrollTop = top;
				}),
			bigTop,
		);

		// 가짜 통과 방지: big.ts가 실제로 재마운트됐고, 헤더가 있으며, 캐시
		// 렌더도 "하이라이트된" 행이어야 한다 (plain-text로 새면 안 됨 — 캐시
		// 보존의 요점이 하이라이트 결과 재사용이다).
		const remounted = await page.evaluate(() => {
			const el = [...document.querySelectorAll("diffs-container")].find(
				(c) =>
					c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
					"src/big.ts",
			);
			const pre = el?.shadowRoot?.querySelector("pre");
			return {
				mounted: el != null,
				hasHeader: el?.shadowRoot?.querySelector("[data-diffs-header]") != null,
				highlighted: pre?.querySelector("span[style]") != null,
				textLen: pre?.textContent?.length ?? 0,
			};
		});
		expect(remounted.mounted).toBe(true);
		expect(remounted.hasHeader).toBe(true);
		expect(remounted.highlighted).toBe(true);
		// CodeView는 파일 간(virtualization)뿐 아니라 파일 내부도 행 단위로
		// 창(windowed) 렌더한다 — 8,000줄 전체가 아니라 뷰포트 버퍼 분량만
		// <pre>에 존재한다(실측 ~4,300자). lockfile-freeze.e2e.ts의 같은 목적
		// 단언(preTextLen)과 동일한 하한(1000)을 써서 "헤더만 그려짐"이 아닌
		// 실질적인 코드 렌더임을 확인한다.
		expect(remounted.textLen).toBeGreaterThan(1000);

		// 60fps 정상 프레임 ~16ms, 캐시 렌더(윈도우 분량 DOM 마운트)는 CI에서도
		// 수십 ms. 8천 줄 동기 재토크나이즈(수백 ms)와 차원이 다른 250ms 상한.
		expect(reentryMaxGapMs).toBeLessThan(250);
	} finally {
		await viewer.stop();
	}
});

test("a file edited while unmounted re-renders fresh content on re-entry (no stale cache)", async ({
	page,
}) => {
	// 캐시 보존의 유일한 실질 회귀 시나리오: 화면 밖(언마운트 = recycle로
	// 캐시가 보존된 상태)에서 파일이 바뀌었는데, 재진입 렌더가 보존된 옛
	// AST를 그대로 내보내는 것. renderDiff의 areDiffTargetsEqual 검증이
	// 이를 막는다는 계약을 실브라우저로 고정한다.
	// bulk 12개(≈11만 px)가 hello.ts(정렬상 최하단)를 초기 뷰포트+오버스캔
	// 밖에 두므로, 첫 화면에서 hello.ts는 언마운트 상태다.
	const viewer = await launchViewer(["--watch"], { bulkFiles: 12 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		await expect(page.locator("diffs-container").first()).toBeVisible();

		// 최하단으로 점프해 hello.ts를 한 번 마운트+하이라이트시켜 캐시를
		// 만든 뒤, 다시 최상단으로 — recycle이 캐시를 보존한 상태를 만든다.
		await page.evaluate(() => {
			const scroller = document.getElementById("diff") as HTMLElement;
			scroller.scrollTop = scroller.scrollHeight;
		});
		await expect
			.poll(
				() =>
					page.evaluate(() =>
						[...document.querySelectorAll("diffs-container")].some((el) =>
							(el.shadowRoot?.textContent ?? "").includes("hello, world"),
						),
					),
				{ timeout: 15_000 },
			)
			.toBe(true);
		await page.evaluate(() => {
			const scroller = document.getElementById("diff") as HTMLElement;
			scroller.scrollTop = 0;
		});
		// hello.ts 언마운트(recycle 실행) 확인.
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							![...document.querySelectorAll("diffs-container")].some(
								(el) =>
									el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
									"src/hello.ts",
							),
					),
				{ timeout: 15_000 },
			)
			.toBe(true);

		// 언마운트 상태에서 워킹트리 편집 → 다음 폴(2s)이 200으로 새 payload를
		// 받는다 (watch-refresh.e2e.ts와 동일 계약).
		writeFileSync(
			join(viewer.repoDir, "src", "hello.ts"),
			'export const hello = (): string => "hello, recycled world";\n',
		);
		await page.waitForResponse(
			(res) => res.url().includes("/api/diff") && res.status() === 200,
			{ timeout: 15_000 },
		);

		// 재진입: 최하단으로 되돌아가면 보존된 캐시가 아니라 새 diff가
		// 렌더돼야 한다.
		await page.evaluate(() => {
			const scroller = document.getElementById("diff") as HTMLElement;
			scroller.scrollTop = scroller.scrollHeight;
		});
		await expect
			.poll(
				() =>
					page.evaluate(() =>
						[...document.querySelectorAll("diffs-container")].some((el) =>
							(el.shadowRoot?.textContent ?? "").includes(
								"hello, recycled world",
							),
						),
					),
				{ timeout: 15_000 },
			)
			.toBe(true);
		// 옛 내용이 남아 있으면 안 된다.
		expect(
			await page.evaluate(() =>
				[...document.querySelectorAll("diffs-container")].some((el) =>
					(el.shadowRoot?.textContent ?? "").includes('"hello, world"'),
				),
			),
		).toBe(false);
	} finally {
		await viewer.stop();
	}
});
