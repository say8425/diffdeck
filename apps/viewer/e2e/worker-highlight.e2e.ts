// 파일이 가상화 윈도우에 "처음" 들어올 때 마운트 프레임이 얼면 안 된다.
//
// non-worker 경로에서는 마운트 프레임 안에서 파일 전체(양쪽)가 동기
// 토크나이즈된다(renderDiffWithHighlighter — 범위 무시, 문법 정합성 정책).
// 4천 줄 파일이면 수백 ms 프리징 — retokenize-cache.e2e.ts가 고친 "재진입"과
// 달리 이것은 "최초 진입" 비용이라 캐시 보존으로는 해결되지 않는다.
// 수정: 뷰어가 workerManager를 주입해 워커 경로를 켠다 — plain AST가 동기로
// 즉시 그려지고(토크나이즈 0) 색은 워커 완료 시 재렌더로 입혀진다.
//
// [설계 이탈 — team-lead 승인] 브리프 원안(전체 문서 스크롤 한 루프만으로
// 측정)은 RED가 나오지 않는다. 이유 둘:
// ① big.ts(4,000줄 × 전량 재작성 = 8,000줄 변경)는 largeFile.ts의
//    LARGE_FILE_LINE_THRESHOLD(1,500) 초과라 첫 등장부터 항상 collapsed로
//    마운트되고(Foundation 예외 2호 emptyWindow = zero-tokenize), 알파벳
//    정렬상 bulk-*.ts보다 앞이라(big < bulk) 스크롤을 시작하기도 전에 이미
//    오버스캔 안에 들어와 있다 — "비싼 첫 진입"이 스크롤 경로에 전혀 없다.
//    나머지 bulk-*.ts(200줄)는 bulk-0 진입 때 이미 문법이 warm돼서 개별 첫
//    진입이 150ms를 못 넘는다. 자매 태스크(perf/preserve-render-cache의
//    retokenize-cache.e2e.ts)가 겪은 것과 동일한 big.ts auto-collapse
//    이슈라, 같은 패턴으로 "헤더 클릭으로 펼치는 스텝"을 추가해 비싼
//    non-collapsed 첫 렌더를 측정 윈도우 안에 강제로 포함시킨다.
// ② 클릭과 스크롤을 같은 루프에 합치면, 클릭 직후에도 계속 진행되는
//    스크롤이 (collapsed 상태의 작은 높이 때문에) big.ts를 오버스캔 밖으로
//    밀어내 펼침 렌더가 완료되기 전에 recycle(언마운트)해버린다 — 진단으로
//    확인(클릭 다음 프레임부터 컨테이너를 못 찾음). 그래서 펼침 갭 측정은
//    스크롤 없이 별도 루프로 분리하고, 전체 문서 스크롤은 그 뒤 별도 루프로
//    다른 파일들의 첫 진입을 훑는다.
import { expect, launchViewer, test } from "./fixtures/app.ts";

test("first entry into the overscan window must not freeze the frame", async ({
	page,
}) => {
	// bigFileLines 4000 = 양쪽 8,000줄. bulk 12개는 문서를 충분히 길게 만들어
	// 스크롤 스윕이 나머지 파일들의 첫 진입도 훑게 한다.
	const viewer = await launchViewer([], { bulkFiles: 12, bigFileLines: 4000 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		await page.mouse.move(2, 2);
		// 초기 렌더·하이라이트가 가라앉을 때까지 대기 — 측정 대상은 이후에
		// 트리거하는 이벤트들뿐이어야 한다.
		await page.waitForTimeout(2000);

		// Phase 1: big.ts 펼침 갭 측정. big.ts는 LARGE_FILE_LINE_THRESHOLD
		// 초과라 이 시점에 이미 collapsed로 마운트돼 있다(비싼 렌더 없음 —
		// 헤더만). rAF 갭 루프 안에서 헤더를 클릭해 펼쳐 "비싼 non-collapsed
		// 첫 렌더"를 강제로 측정 윈도우에 넣는다. 스크롤은 하지 않는다 — 위
		// Global Constraints 주석 ②대로, 스크롤이 겹치면 collapsed의 작은
		// 높이 때문에 펼침 렌더가 끝나기 전에 recycle될 수 있다.
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
						// CodeView.updateItem()은 render(immediate=false)를 통해 실제
						// 동기 렌더를 queueRender로 "다음 rAF"에 미룬다(engine의
						// UniversalRenderingManager) — 그래서 비싼 토크나이즈는 클릭
						// 자체가 아니라 클릭 다음 프레임에서 터진다. 이 루프가 클릭
						// *전부터* 이미 돌고 있어야 그 프레임의 갭을 잡을 수 있다 —
						// 순서를 바꿔 클릭 후에 루프를 시작하면 이 가드는 조용히
						// 무력화된다.
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

		// 가짜 통과 방지: big.ts가 실제로 펼쳐져 코드 행이 렌더된 적이 있는지 —
		// 클릭이 씹혀 collapsed로 남으면 갭이 0이라 그냥 "통과"해버리는 경로를
		// 막는다(lockfile-freeze.e2e.ts의 textLen 하한 선례와 동일 패턴).
		expect(sawExpandedBig).toBe(true);

		// 워커 경로의 plain 렌더는 CI 여유를 크게 잡아도 수십 ms. 동기
		// 토크나이즈(수백 ms~수 초, 프로토타입 실측 non-worker 4,886.5ms)와
		// 차원이 다른 150ms 상한.
		expect(expandGapMs).toBeLessThan(150);

		// Phase 2: 전체 문서 스크롤 — 나머지 파일들(bulk-*.ts/hello.ts 등)의
		// 첫 진입도 같은 150ms 상한을 지키는지 훑는다.
		const scrollGapMs = await page.evaluate(
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
						// 900px/frame × 240 frames ≈ 216k px — 전체 문서를 통과하며
						// 모든 파일의 "최초 진입"을 유발한다.
						scroller.scrollTop += 900;
						if (frames < 240) requestAnimationFrame(tick);
						else resolve(maxGap);
					};
					requestAnimationFrame(tick);
				}),
		);

		// 가짜 통과 방지: 파일들이 실제로 마운트됐는지.
		const mounted = await page.evaluate(
			() => document.querySelectorAll("diffs-container").length,
		);
		expect(mounted).toBeGreaterThan(0);
		expect(scrollGapMs).toBeLessThan(150);

		// plain → 색 전이: 컨테이너들에 하이라이트가 "결국" 적용된다 (워커
		// 옵션 정합이 깨지면 여기서 영영 실패한다 — Global Constraints의
		// 옵션 정합 함정 참조).
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
				{ timeout: 20_000 },
			)
			.toBe(true);
	} finally {
		await viewer.stop();
	}
});
