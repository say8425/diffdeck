// 계약은 viewer.md "CodeView 수명과 스크롤". 픽셀이 아니라 앵커로 단언한다 —
// unified와 split은 콘텐츠 높이가 달라 scrollTop이 같을 수 없으므로, 전환 전
// 최상단 파일의 뷰포트 기준 오프셋(anchorOffset)을 비교한다.
import {
	ANCHOR_TOLERANCE_PX,
	anchorOffset,
	expect,
	launchViewer,
	renderedDiffType,
	test,
	topVisibleFileId,
	waitForStableHeight,
	waitForStableScrollTop,
} from "./fixtures/app.ts";

test("switching Unified/Split keeps the viewport anchored instead of jumping to the top", async ({
	page,
}) => {
	// 맨 위로 튕기는 회귀가 분명히 보이도록 깊게 스크롤할 거리를 만든다. 파일마다
	// 변경량이 자동 접힘 임계값 아래라 본문이 렌더된다.
	const viewer = await launchViewer([], { bulkFiles: 12 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		// 포인터를 패널 밖에 둬 :hover 간섭을 없앤다.
		await page.mouse.move(2, 2);

		const scroller = page.locator("#diff");
		await waitForStableHeight(scroller);

		await scroller.evaluate((el) => {
			el.scrollTop = Math.floor(el.scrollHeight / 2);
		});
		await waitForStableScrollTop(scroller);

		const anchorFileId = await topVisibleFileId(page);
		expect(anchorFileId).not.toBeNull();
		const anchorContainer = page
			.locator("diffs-container")
			.filter({ has: page.locator(`[data-fold="${anchorFileId}"]`) });
		await expect(anchorContainer).toBeInViewport();
		const offsetBefore = await anchorOffset(page, anchorFileId as string);

		await page.locator('#diff-style-group [data-style="split"]').click();
		await expect(
			page.locator('#diff-style-group [data-style="split"]'),
		).toHaveAttribute("aria-pressed", "true");

		await expect
			.poll(() => scroller.evaluate((el) => el.scrollTop))
			.toBeGreaterThan(0);
		await expect(anchorContainer).toBeInViewport();
		await expect
			.poll(
				async () =>
					Math.abs(
						(await anchorOffset(page, anchorFileId as string)) - offsetBefore,
					),
				{ timeout: 10_000 },
			)
			.toBeLessThanOrEqual(ANCHOR_TOLERANCE_PX);

		// 엘리먼트 풀은 diffStyle이 바뀌어도 살아남는다(shouldClearPool) —
		// 재활용된 노드가 unified 모양을 끌고 오지 않는지 구조로 본다.
		await expect
			.poll(() => renderedDiffType(page), { timeout: 10_000 })
			.toBe("split");
	} finally {
		await viewer.stop();
	}
});

test("switching back to Unified keeps the viewport anchored too", async ({
	page,
}) => {
	const viewer = await launchViewer(["--split"], { bulkFiles: 12 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		await page.mouse.move(2, 2);
		await expect
			.poll(() => renderedDiffType(page), { timeout: 10_000 })
			.toBe("split");

		const scroller = page.locator("#diff");
		await waitForStableHeight(scroller);

		await scroller.evaluate((el) => {
			el.scrollTop = Math.floor(el.scrollHeight / 2);
		});
		await waitForStableScrollTop(scroller);

		const anchorFileId = await topVisibleFileId(page);
		expect(anchorFileId).not.toBeNull();
		const anchorContainer = page
			.locator("diffs-container")
			.filter({ has: page.locator(`[data-fold="${anchorFileId}"]`) });
		await expect(anchorContainer).toBeInViewport();
		const offsetBefore = await anchorOffset(page, anchorFileId as string);

		await page.locator('#diff-style-group [data-style="unified"]').click();
		await expect(
			page.locator('#diff-style-group [data-style="unified"]'),
		).toHaveAttribute("aria-pressed", "true");

		await expect
			.poll(() => scroller.evaluate((el) => el.scrollTop))
			.toBeGreaterThan(0);
		await expect(anchorContainer).toBeInViewport();
		await expect
			.poll(
				async () =>
					Math.abs(
						(await anchorOffset(page, anchorFileId as string)) - offsetBefore,
					),
				{ timeout: 10_000 },
			)
			.toBeLessThanOrEqual(ANCHOR_TOLERANCE_PX);
		await expect
			.poll(() => renderedDiffType(page), { timeout: 10_000 })
			.toBe("single");
	} finally {
		await viewer.stop();
	}
});
