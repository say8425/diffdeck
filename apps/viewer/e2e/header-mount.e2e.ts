// Fast scrolling must never paint a file inside the diff pane without its
// sticky header.
//
// CodeView virtualizes the file list, and unmounting a file recycles its
// renderer: DiffHunksRenderer.recycle() drops the shared highlighter
// (packages/diffs/src/renderers/DiffHunksRenderer.ts:242-243) even though the
// constructor could re-acquire it synchronously (:228-232). So on re-mount
// renderDiff() returns null, and FileDiff.render() appends the (empty) <pre>
// at FileDiff.ts:859 and then bails at :885 — above applyHeaderToDOM at :896.
// (The viewer now injects a workerManager; this highlighter branch is the
// non-worker FALLBACK path, still exercised when worker creation fails.)
// The file is therefore mounted headerless and 0-height until an async
// highlight lands a couple of frames later. The engine hides that gap by
// rendering ahead of the viewport (VirtualizerConfig.overscrollSize: "extra
// pixels rendered above and below the viewport to reduce blanking during fast
// scrolls"), so the gap is only ever *seen* when one frame's scroll delta
// outruns the buffer — which reads to the user as the header blinking.
import type { Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";

interface ScrollProbe {
	defectiveFrames: number;
	scrolled: number;
	filesMounted: number;
	/**
	 * Whether the scroller ran out of content mid-probe. Every frame after that
	 * scrolls zero pixels and passes for free, so a probe that bottoms out
	 * silently understates the defect — the result is only trustworthy when
	 * this is false.
	 */
	hitBottom: boolean;
}

// Drive the scroll from inside the page (one step per animation frame, so each
// step is exactly one composited frame's delta) and, in that same frame, check
// every mounted container that overlaps the visible pane for its header.
const probeScroll = (
	page: Page,
	pxPerFrame: number,
	frames: number,
): Promise<ScrollProbe> =>
	page.evaluate(
		([px, total]) =>
			new Promise<ScrollProbe>((resolve) => {
				const scroller = document.getElementById("diff") as HTMLElement;
				const startTop = scroller.scrollTop;
				// The engine pools and reuses the <diffs-container> elements
				// themselves, so element identity says nothing about how many files
				// were mounted. The file id each container currently carries does.
				const fileIds = new Set<string>();
				let defectiveFrames = 0;
				let frame = 0;
				let hitBottom = false;

				const step = (): void => {
					scroller.scrollTop += px;
					if (
						scroller.scrollTop + scroller.clientHeight >=
						scroller.scrollHeight - 1
					)
						hitBottom = true;
					const pane = scroller.getBoundingClientRect();
					let defective = false;
					for (const container of document.querySelectorAll(
						"diffs-container",
					)) {
						const fileId =
							container.querySelector<HTMLElement>("[data-fold]")?.dataset.fold;
						if (fileId != null) fileIds.add(fileId);
						const rect = container.getBoundingClientRect();
						// 0-height 컨테이너는 화면에 아무것도 그리지 않는다 — 풀
						// 요소가 파일을 배정받기 전의 전환 상태로, degenerate rect
						// (top == bottom)가 overlap 판정을 오탐시키므로 제외한다.
						// 이 단언의 대상은 "그려진" 파일이 헤더 없이 보이는 것.
						if (rect.height === 0) continue;
						const overlapsPane =
							rect.bottom > pane.top && rect.top < pane.bottom;
						const hasHeader =
							container.shadowRoot?.querySelector("[data-diffs-header]") !=
							null;
						if (overlapsPane && !hasHeader) defective = true;
					}
					if (defective) defectiveFrames++;
					frame++;
					if (frame < total) requestAnimationFrame(step);
					else
						resolve({
							defectiveFrames,
							scrolled: scroller.scrollTop - startTop,
							filesMounted: fileIds.size,
							hitBottom,
						});
				};
				requestAnimationFrame(step);
			}),
		[pxPerFrame, frames] as const,
	);

test("fast scrolling never paints a headerless file in the diff pane", async ({
	page,
}) => {
	// The shared fixture renders shorter than the viewport, so it cannot scroll
	// at all and would make this test silently vacuous. Opt into a tall diff —
	// tall enough that the extreme-fling probe below never bottoms out.
	const viewer = await launchViewer([], { bulkFiles: 16 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		await expect(page.locator("diffs-container").first()).toBeVisible();
		// Keep the pointer off the pane: :hover styling must not confound this.
		await page.mouse.move(2, 2);

		// Every probe must actually exercise the path it claims to: the scroller
		// must never run out of content (frames past the bottom scroll zero
		// pixels and pass for free) and virtualization must really have mounted
		// more files than fit at once. Without this a shorter fixture — or a
		// probe asking for more pixels than the diff has — would pass vacuously.
		const assertMeaningful = (
			probe: ScrollProbe,
			requested: number,
			minFiles: number,
		): void => {
			expect(probe.hitBottom).toBe(false);
			expect(probe.scrolled).toBe(requested);
			expect(probe.filesMounted).toBeGreaterThanOrEqual(minFiles);
		};

		// Slow scroll stays comfortably inside the render-ahead buffer: the
		// baseline showing the probe reports clean when the gap is off-screen.
		// Short enough that it stays within a file or two — enough to show the
		// probe reports clean at a velocity the buffer easily absorbs.
		const slow = await probeScroll(page, 100, 40);
		assertMeaningful(slow, 100 * 40, 2);
		expect(slow.defectiveFrames).toBe(0);

		// 400px/frame (~24k px/s): the fastest velocity the 1000px render-ahead
		// buffer fully covers on its own.
		const fast = await probeScroll(page, 400, 60);
		assertMeaningful(fast, 400 * 60, 4);
		expect(fast.defectiveFrames).toBe(0);

		// 800px/frame extreme fling: beyond what any render-ahead buffer can
		// absorb, so this only passes because DiffHunksRenderer.recycle() keeps
		// its highlighter (re-acquired synchronously like the constructor does) —
		// a re-mounted file must paint its header in the same frame it mounts,
		// never waiting on an async highlight.
		// 32,000px를 지나며 벌크 파일(개당 ~10k px)을 여럿 넘는다 — 4개 이상의
		// 서로 다른 파일이 마운트됐다면 재활용 경로가 실제로 여러 번 돌았다.
		const extreme = await probeScroll(page, 800, 40);
		assertMeaningful(extreme, 800 * 40, 4);
		expect(extreme.defectiveFrames).toBe(0);
	} finally {
		await viewer.stop();
	}
});

test("fallback (non-worker) path: fast scrolling never paints a headerless file", async ({
	page,
}) => {
	// 워커 배선 이후 위 테스트는 워커 경로(plain 동기 렌더 — blink가 설계상
	// 불가능)에서 돈다. Foundation 예외 1호(recycle의 하이라이터 동기 재획득)는
	// non-worker 경로 전용 이탈이므로, 워커 스크립트 로드를 route.abort()로
	// 차단해 앱 워치독(recoverFromWorkerLoadFailure)의 non-worker 폴백을
	// 강제한 뒤 동일한 극한 플링 프로브를 반복한다 — 예외 1호의 회귀망은 이
	// 테스트다.
	await page.route("**/worker.js", (route) => route.abort());
	const viewer = await launchViewer([], { bulkFiles: 16 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		// 워치독 복구(CodeView 재구성 → non-worker 동기 하이라이트)가 끝났음을
		// 하이라이트된 span으로 확인한 뒤에 프로브를 시작한다 — 복구 도중의
		// 재구성 프레임을 극한 프로브가 오탐하지 않게 한다.
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
		await page.mouse.move(2, 2);

		// 위 첫 테스트의 800px/frame 극한 프로브와 동일 강도 — non-worker
		// 경로에서도 recycle이 헤더 없는 프레임을 만들지 않는지 확인한다.
		const extreme = await probeScroll(page, 800, 40);
		expect(extreme.hitBottom).toBe(false);
		expect(extreme.scrolled).toBe(800 * 40);
		expect(extreme.filesMounted).toBeGreaterThanOrEqual(4);
		expect(extreme.defectiveFrames).toBe(0);
	} finally {
		await viewer.stop();
	}
});
