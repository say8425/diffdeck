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
import type { Locator, Page } from "@playwright/test";
import {
	expect,
	launchViewer,
	renderedDiffType,
	test,
} from "./fixtures/app.ts";

// 어떤 수치가 정착할 때까지 기다린다 — sleep 대신 "연속 두 번 같은 값".
const waitForStable = async (
	read: () => Promise<number>,
	requirePositive = true,
): Promise<void> => {
	let last = Number.NaN;
	await expect
		.poll(
			async () => {
				const value = await read();
				const stable = (!requirePositive || value > 0) && value === last;
				last = value;
				return stable;
			},
			{ timeout: 15_000, intervals: [100] },
		)
		.toBe(true);
};

// 초기 레이아웃 정착. CodeView는 아이템 높이를 추정으로 먼저 채우고 실제
// 측정되는 대로 늘려가므로, 정착 전에 "높이의 절반"으로 스크롤하면 같은
// 비율이라도 매번 다른 파일에 떨어진다 — 그 창에서는 엔진이 잡는 앵커와
// 아래 topVisibleFileId()가 DOM rect로 읽는 앵커가 어긋난다.
const waitForStableHeight = (scroller: Locator): Promise<void> =>
	waitForStable(() => scroller.evaluate((el) => el.scrollHeight));

// 스크롤 위치 정착. scrollTop을 직접 대입해도 엔진은 다음 프레임에 자기
// 페이지드 스크롤 모델로 위치를 보정할 수 있다. 보정 전에 앵커를 샘플링하면
// 그 뒤 뷰포트가 움직여 앵커가 화면 밖으로 나갈 수 있으므로, 값이 멈춘 뒤에
// 읽는다.
const waitForStableScrollTop = (scroller: Locator): Promise<void> =>
	waitForStable(() => scroller.evaluate((el) => el.scrollTop));

// 뷰포트 최상단에 걸친 첫 diff 컨테이너의 파일 id. 스크롤 컨테이너와
// 컨테이너들의 실제 rect를 비교해 구한다 (가상화로 렌더 윈도우 밖 파일은
// DOM에 없지만, 최상단 파일은 반드시 있다).
const topVisibleFileId = (page: Page): Promise<string | null> =>
	page.evaluate(() => {
		const scroller = document.getElementById("diff") as HTMLElement;
		const { top } = scroller.getBoundingClientRect();
		for (const c of document.querySelectorAll("diffs-container")) {
			// 1px 여유: 최상단 파일의 하단 경계가 뷰포트 상단에 정확히 닿은
			// 경우를 "보인다"로 세지 않는다.
			if (c.getBoundingClientRect().bottom > top + 1) {
				return (
					c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ?? null
				);
			}
		}
		return null;
	});

// 한 파일의 상단이 스크롤 뷰포트 상단으로부터 몇 px 떨어져 있는지.
//
// 이게 "앵커됐다"와 "그냥 비례로 늘어났다"를 가르는 신호다. 파일 하나가
// 뷰포트 여러 개 높이라 "뷰포트 안에 있다"만으로는 둘을 구분할 수 없다 —
// 엔진이 앵커를 놓치고 scrollTop을 높이 비율로만 환산해도 같은 파일 안에
// 떨어질 가능성이 높기 때문. 반면 아이템 앵커링은 그 파일의 상단을 뷰포트
// 기준 같은 위치에 정확히 붙들어 둔다. 두 예측은 실제로 갈린다: 헤더·이미지
// 카드처럼 스타일에 따라 줄지 않는 고정 높이가 섞여 있어 전체 높이는
// 균일하게 스케일되지 않는다.
const anchorOffset = (page: Page, fileId: string): Promise<number> =>
	page.evaluate((id) => {
		const scroller = document.getElementById("diff") as HTMLElement;
		const container = [...document.querySelectorAll("diffs-container")].find(
			(el) => el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold === id,
		);
		// 렌더 윈도우 밖으로 밀려나 아예 없으면 NaN — 단언이 통과할 수 없다.
		if (!container) return Number.NaN;
		return Math.round(
			container.getBoundingClientRect().top -
				scroller.getBoundingClientRect().top,
		);
	}, fileId);

// 앵커 유지 허용 오차(px). 실측은 전환 전후가 정확히 일치했지만(-100 → -100),
// 서브픽셀 반올림 여지를 둔다. 비례 스케일로 어긋나면 수백 px씩 벌어지므로
// 이 폭으로도 회귀는 확실히 잡힌다.
const ANCHOR_TOLERANCE_PX = 40;

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
