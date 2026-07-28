// Unified/Split 토글은 읽던 위치를 잃지 않아야 한다.
//
// renderPatch()가 diffStyle 변경 시 CodeView를 통째로 재생성하던 시절엔
// `diffMount.replaceChildren()`으로 스크롤 컨테이너(#diff = diffMount 그 자체)가
// 비워지면서 scrollHeight가 무너져 브라우저가 scrollTop을 0으로 클램프했다 —
// 수천 줄을 내려 읽다 스타일을 바꾸면 맨 위로 튕겼다.
//
// 수정: 재생성 대신 codeView.setOptions()를 태운다. 엔진은 diffStyle을
// item-layout 옵션으로 취급하고(CodeView.ts hasItemLayoutOptionChanged),
// setOptions 진입 즉시 capturePendingLayoutAnchor()로 앵커를 잡아 렌더
// 경로에서 resolveAnchoredScrollTop()으로 뷰포트를 붙든다.
//
// 단언은 픽셀이 아니라 앵커 기준이다: unified와 split은 콘텐츠 높이 자체가
// 달라(split은 삭제/추가 줄이 좌우로 짝지어져 행 수가 준다) scrollTop이 같을
// 수 없다 — 실제로 split 전환 시 scrollHeight가 대략 절반이 된다. 대신 전환
// 전 뷰포트 최상단에 있던 파일이 전환 후에도 뷰포트 기준 같은 오프셋에
// 있는지를 본다(anchorOffset — 왜 "뷰포트 안에 있다"로는 부족한지는 그
// 헬퍼의 주석 참고).
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
	// bulk 12개 × 200줄 전량 재작성 = 수천 행. 맨 위로 튕기는 회귀가
	// 애매하지 않게 검출되도록 충분히 깊게 스크롤할 거리를 만든다.
	// (200줄 파일의 변경 400줄은 largeFile.ts의 1,500줄 임계 아래라
	// 자동 접힘 없이 본문이 렌더된다.)
	const viewer = await launchViewer([], { bulkFiles: 12 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		// 포인터를 패널 밖에 둬 :hover 스타일 간섭 배제 (header-mount 패턴).
		await page.mouse.move(2, 2);

		const scroller = page.locator("#diff");
		await waitForStableHeight(scroller);

		// 중간까지 내려간다.
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

		// 핵심 단언: 맨 위로 튕기지 않았고, 읽던 파일이 뷰포트 기준 같은 자리에
		// 그대로 있다. scrollTop 픽셀 동일성은 단언하지 않는다 — 스타일 간에
		// 정당하게 다르다(split은 scrollHeight가 대략 절반).
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

		// 실제로 split으로 렌더됐는가. shouldClearPool()은 diffStyle을 보지
		// 않으므로(엘리먼트 풀이 살아남는다) 재활용된 노드가 unified 모양을
		// 끌고 오지 않는지 구조로 확인한다.
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
	// 되돌아오는 방향도 같은 계약이다. 풀 재사용 관점에선 이쪽이 더 까다롭다 —
	// split 모양으로 그려졌던 노드를 unified로 되돌려 쓰기 때문.
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
