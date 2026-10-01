// 빠른 스크롤에서 diff 패널에 헤더 없는 파일이 그려지면 안 된다. 렌더 선행
// 버퍼(overscrollSize)가 감추지 못할 만큼 한 프레임의 스크롤이 커야 판별된다.
// non-worker 경로에서는 vendored 예외 1(recycle의 하이라이터 동기 재획득)이
// 이를 막는다(vendored-packages.md).
import type { Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";

interface ScrollProbe {
	defectiveFrames: number;
	scrolled: number;
	filesMounted: number;
	/**
	 * 바닥에 닿은 뒤의 프레임은 0px 스크롤이라 공짜로 통과한다 — false일 때만
	 * 결과를 믿는다.
	 */
	hitBottom: boolean;
}

// rAF마다 한 번 스크롤해 한 단계 = 한 프레임의 델타로 만들고, 같은 프레임에서
// 패널에 겹친 컨테이너의 헤더를 본다. 프레임 안의 scrollTop 대입은 e2e.md의
// 멈춤 함정이 있는 패턴이다.
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
				// 컨테이너 요소는 풀에서 재사용되므로 요소가 아니라 파일 id로 센다.
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
						// 0높이 컨테이너(파일을 배정받기 전의 풀 요소)는 아무것도
						// 그리지 않고, 퇴화한 rect가 겹침 판정을 오탐한다.
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
	// 극한 플링도 바닥에 닿지 않을 만큼 긴 diff를 쓴다.
	const viewer = await launchViewer([], { bulkFiles: 16 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
		await expect(page.locator("diffs-container").first()).toBeVisible();
		// 포인터를 패널 밖에 둔다(:hover 간섭 배제).
		await page.mouse.move(2, 2);

		const assertMeaningful = (
			probe: ScrollProbe,
			requested: number,
			minFiles: number,
		): void => {
			expect(probe.hitBottom).toBe(false);
			expect(probe.scrolled).toBe(requested);
			expect(probe.filesMounted).toBeGreaterThanOrEqual(minFiles);
		};

		// 버퍼가 넉넉히 덮는 속도에서 프로브가 깨끗하다는 기준선.
		const slow = await probeScroll(page, 100, 40);
		assertMeaningful(slow, 100 * 40, 2);
		expect(slow.defectiveFrames).toBe(0);

		const fast = await probeScroll(page, 400, 60);
		assertMeaningful(fast, 400 * 60, 4);
		expect(fast.defectiveFrames).toBe(0);

		// 극한 플링. 서로 다른 파일이 4개 이상 마운트돼야 재활용 경로가 여러 번
		// 돈 것이다.
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
	// vendored 예외 1의 회귀망. 위 테스트는 워커 경로에서 돌고 예외 1은
	// non-worker 경로에만 걸리므로, 워커 로드를 막아 워치독의 폴백 경로에서
	// 같은 극한 플링을 돌린다.
	await page.route("**/worker.js", (route) => route.abort());
	const viewer = await launchViewer([], { bulkFiles: 16 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		// 워치독 복구가 끝난 뒤(하이라이트가 보인 뒤)에 잰다 — 재구성 중의
		// 프레임을 오탐하지 않게.
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

		const extreme = await probeScroll(page, 800, 40);
		expect(extreme.hitBottom).toBe(false);
		expect(extreme.scrolled).toBe(800 * 40);
		expect(extreme.filesMounted).toBeGreaterThanOrEqual(4);
		expect(extreme.defectiveFrames).toBe(0);
	} finally {
		await viewer.stop();
	}
});
