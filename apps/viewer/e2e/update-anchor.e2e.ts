// 갱신은 픽셀이 아니라 앵커로 위치를 지킨다(viewer.md "CodeView 수명과 스크롤").
// 앵커보다 위의 파일을 늘려 갱신하면 픽셀 복원은 늘어난 만큼 어긋난다.
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
		// 앵커가 편집할 bulk-0.ts보다 아래여야 위쪽이 늘어나는 효과를 본다.
		expect(anchorFileId).toMatch(/^src\/bulk-(?:[2-9]|1[01])\.ts$/);
		const offsetBefore = await anchorOffset(page, anchorFileId as string);
		const heightBefore = await scroller.evaluate((el) => el.scrollHeight);

		writeFileSync(
			join(viewer.repoDir, "src", "bulk-0.ts"),
			bulkLines("edited", 260),
		);
		await page.locator("#refresh").click();

		// 레이아웃이 실제로 커졌는지 먼저 본다 — 안 커졌으면 아래 단언이 빈 통과다.
		await expect
			.poll(() => scroller.evaluate((el) => el.scrollHeight), {
				timeout: 15_000,
			})
			.toBeGreaterThan(heightBefore);
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

interface RafGate {
	queued: Map<number, FrameRequestCallback>;
	raf: typeof window.requestAnimationFrame;
	caf: typeof window.cancelAnimationFrame;
	next: number;
}

type GateWindow = Window & { rafGate?: RafGate };

// rAF를 붙잡아 두 renderPatch가 한 프레임에 겹치는 경우를 결정적으로 만든다
// (게이트 없이는 확률적이다). 합성 id는 음수라 진짜 rAF id와 섞이지 않고,
// cancelAnimationFrame도 스텁해 엔진의 queueRender 디듀프가 남의 프레임을
// 취소하지 않게 한다.
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

		// 앵커보다 아래 파일만 바꿔 갱신 자체는 위쪽 레이아웃을 흔들지 않게 한다.
		writeFileSync(
			join(viewer.repoDir, "src", "bulk-11.ts"),
			bulkLines("edited", 240),
		);

		await installRafGate(page);
		await page.locator('#diff-style-group [data-style="split"]').click();

		// 게이트가 rAF를 가로챘는지 큐로 확인한다 — scrollTop 비교만으로는
		// 가로채기가 실패해도 다음 프레임 전에 읽으면 통과한다.
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
