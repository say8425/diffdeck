// 데이터 갱신(refresh·watch)도 읽던 위치를 픽셀이 아니라 앵커로 지켜야 한다.
//
// renderPatch의 평범한 갱신 경로는 오랫동안 이렇게 동작했다:
//   const scrollTop = codeView.getScrollTop();
//   codeView.setItems(items); codeView.render();
//   codeView.scrollTo({ type: "position", position: scrollTop });
// 즉 갱신 전 scrollTop을 픽셀 그대로 되돌린다. 뷰포트 "위쪽" 파일의 길이가
// 변하면 그 아래 내용이 통째로 밀리므로, 같은 픽셀로 돌아가면 읽던 줄이
// 밀린 만큼 어긋난다.
//
// 엔진은 이미 이걸 의미론적으로 처리한다: setItems → reconcileItems가
// markLayoutDirtyFromIndex를 세우면 렌더 경로가 layoutDirtyIndex != null을
// 보고 scroll correction을 무조건 재무장하고(CodeView.ts), pendingLayoutAnchor가
// 없으면 getScrollAnchor가 renderState에서 앵커를 새로 만들어
// resolveAnchoredScrollTop으로 뷰포트를 붙든다. 그래서 앱이 얹던 픽셀 scrollTo는
// 잉여일 뿐 아니라 그 보정을 pendingScrollTarget으로 덮어써 무력화한다.
//
// 이 스펙은 그 차이를 직접 가른다: 앵커보다 "위"에 있는 파일을 길게 만들고
// 갱신하면, 픽셀 복원은 앵커 파일을 밀린 만큼 어긋나게 두고 앵커 복원은
// 뷰포트 기준 같은 자리에 붙들어 둔다.
import type { Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	ANCHOR_TOLERANCE_PX,
	anchorOffset,
	expect,
	launchViewer,
	test,
	topVisibleFileId,
	waitForStableHeight,
	waitForStableScrollTop,
} from "./fixtures/app.ts";

// repo.ts의 bulkFileLines와 같은 모양 — 픽스처가 내보내지 않아 여기서 만든다.
const bulkLines = (marker: string, length: number): string =>
	`${Array.from(
		{ length },
		(_, i) =>
			`export const ${marker}_${i} = ${i}; // ${marker} filler line ${i}`,
	).join("\n")}\n`;

test("a refresh that grows a file above the viewport keeps the anchor put", async ({
	page,
}) => {
	const viewer = await launchViewer([], { bulkFiles: 12 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		await page.mouse.move(2, 2);

		const scroller = page.locator("#diff");
		await waitForStableHeight(scroller);
		await scroller.evaluate((el) => {
			el.scrollTop = Math.floor(el.scrollHeight / 2);
		});
		await waitForStableScrollTop(scroller);

		const anchorFileId = await topVisibleFileId(page);
		// 편집할 src/bulk-0.ts보다 아래(문서상 뒤)에 앵커가 있어야 이 테스트가
		// 의미를 갖는다 — 위쪽이 밀릴 때 앵커가 따라 밀리는지를 보는 것이므로.
		expect(anchorFileId).toMatch(/^src\/bulk-(?:[2-9]|1[01])\.ts$/);
		const offsetBefore = await anchorOffset(page, anchorFileId as string);
		const heightBefore = await scroller.evaluate((el) => el.scrollHeight);

		// 앵커보다 위에 있는 파일을 60줄 늘린다 → 아래 내용이 통째로 밀린다.
		writeFileSync(
			join(viewer.repoDir, "src", "bulk-0.ts"),
			bulkLines("edited", 260),
		);
		await page.locator("#refresh").click();

		// 레이아웃이 실제로 커졌는지 먼저 확인 — 안 커졌으면 아래 단언이
		// 아무것도 검증하지 못한다.
		await expect
			.poll(() => scroller.evaluate((el) => el.scrollHeight), {
				timeout: 15_000,
			})
			.toBeGreaterThan(heightBefore);
		await waitForStableScrollTop(scroller);

		// 읽던 파일이 뷰포트 기준 같은 자리에 남아 있어야 한다. 픽셀 복원이면
		// 위쪽이 늘어난 만큼(수백~천 px) 어긋난다.
		expect(
			Math.abs(
				(await anchorOffset(page, anchorFileId as string)) - offsetBefore,
			),
		).toBeLessThanOrEqual(ANCHOR_TOLERANCE_PX);
	} finally {
		await viewer.stop();
	}
});

interface RafGate {
	queued: Map<number, FrameRequestCallback>;
	raf: typeof window.requestAnimationFrame;
	caf: typeof window.cancelAnimationFrame;
	next: number;
}

type GateWindow = Window & { rafGate?: RafGate };

// rAF를 붙잡아 "두 번의 renderPatch가 한 프레임 안에 일어나는" 상황을
// 결정적으로 만든다. 실제로는 --watch 폴링 응답이 토글과 같은 ~16ms 안에
// 떨어져야 하는 희귀한 창이라, 게이트 없이는 재현이 확률적이다.
// 합성 id는 음수로 만들어 진짜 rAF id와 섞이지 않게 하고,
// cancelAnimationFrame도 함께 스텁해 엔진의 queueRender 디듀프가 남의 프레임을
// 취소하지 않도록 한다.
const installRafGate = (page: Page): Promise<void> =>
	page.evaluate(() => {
		const w = window as GateWindow;
		const gate: RafGate = {
			queued: new Map(),
			raf: window.requestAnimationFrame.bind(window),
			caf: window.cancelAnimationFrame.bind(window),
			next: 1,
		};
		w.rafGate = gate;
		window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
			const id = -gate.next++;
			gate.queued.set(id, cb);
			return id;
		};
		window.cancelAnimationFrame = (id: number): void => {
			if (id < 0) gate.queued.delete(id);
			else gate.caf(id);
		};
	});

const releaseRafGate = (page: Page): Promise<void> =>
	page.evaluate(() => {
		const w = window as GateWindow;
		const gate = w.rafGate;
		if (!gate) return;
		window.requestAnimationFrame = gate.raf;
		window.cancelAnimationFrame = gate.caf;
		const callbacks = [...gate.queued.values()];
		gate.queued.clear();
		w.rafGate = undefined;
		const now = performance.now();
		for (const cb of callbacks) cb(now);
	});

test("a refresh landing in the same frame as a style toggle must not clobber the anchor", async ({
	page,
}) => {
	const viewer = await launchViewer([], { bulkFiles: 12 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		await page.mouse.move(2, 2);

		const scroller = page.locator("#diff");
		await waitForStableHeight(scroller);
		await scroller.evaluate((el) => {
			el.scrollTop = Math.floor(el.scrollHeight / 2);
		});
		await waitForStableScrollTop(scroller);

		const anchorFileId = await topVisibleFileId(page);
		expect(anchorFileId).toMatch(/^src\/bulk-(?:[2-9]|1[01])\.ts$/);
		const offsetBefore = await anchorOffset(page, anchorFileId as string);
		const scrollTopBefore = await scroller.evaluate((el) => el.scrollTop);

		// 앵커보다 아래 파일만 바꾼다 — 갱신 자체가 위쪽 레이아웃을 흔들지
		// 않으므로, 올바른 결과는 "앵커가 같은 자리"로 명확하다.
		writeFileSync(
			join(viewer.repoDir, "src", "bulk-11.ts"),
			bulkLines("edited", 240),
		);

		await installRafGate(page);
		await page.locator('#diff-style-group [data-style="split"]').click();

		// 게이트가 실제로 rAF를 가로챘는지 직접 확인한다. 큐에 콜백이 쌓였다는
		// 사실은 타이밍과 무관한 신호다.
		//
		// 아래 scrollTop 비교만으로는 부족하다: 가로채기가 실패하더라도
		// 클릭→evaluate 왕복이 다음 실제 프레임보다 빠르면 값이 아직 안 바뀌어
		// 그대로 통과한다(게이트를 no-op으로 만들어 실측 확인). 그러면 이
		// 스펙은 레이스를 재현하지 못한 채 경계선 근처를 찔러보는 테스트로
		// 조용히 강등된다. 두 단언은 서로 다른 실패를 잡는다 — 가로채기 실패와
		// 프레임 적용 여부.
		expect(
			await page.evaluate(
				() => (window as GateWindow).rafGate?.queued.size ?? 0,
			),
		).toBeGreaterThan(0);
		expect(await scroller.evaluate((el) => el.scrollTop)).toBe(scrollTopBefore);

		// 토글의 렌더가 아직 걸려 있는 동안 갱신 응답이 도착하게 한다.
		await page.locator("#refresh").click();
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});

		await releaseRafGate(page);
		await waitForStableScrollTop(scroller);

		expect(
			Math.abs(
				(await anchorOffset(page, anchorFileId as string)) - offsetBefore,
			),
		).toBeLessThanOrEqual(ANCHOR_TOLERANCE_PX);
	} finally {
		await viewer.stop();
	}
});
