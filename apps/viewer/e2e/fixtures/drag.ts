// grab.e2e.ts·grab-highlight.e2e.ts가 함께 쓰는 합성 드래그. 튜닝값은 여기서만
// 고친다.
// - 단계 사이 sleep: 없으면 Chrome이 mousedown 앵커를 못 잡아 선택이 빈다
//   (`steps`만으로는 부족하다).
// - 텍스트 드래그는 행 시작에서 40px 띄워 시작한다(호출부의 `x + 40`): 호버한
//   행의 거터 "+" 버튼이 행 콘텐츠 앞부분을 덮어서, 가까이서 누르면 거터 경로가
//   가로채 팝오버가 열린다.
// - 끝점은 텍스트 끝 너머다(호출부의 `x + width - 5`): 브라우저가 줄 끝으로
//   클램프하므로 글꼴 폭과 무관하게 마지막 줄이 온전히 잡힌다.
import type { Locator, Page } from "@playwright/test";
import { expect } from "./app.ts";

export const dragSelect = async (
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
): Promise<void> => {
	await page.mouse.move(from.x, from.y);
	await page.waitForTimeout(30);
	await page.mouse.down();
	await page.waitForTimeout(30);
	await page.mouse.move(to.x, to.y, { steps: 10 });
	await page.waitForTimeout(30);
	await page.mouse.up();
	await page.waitForTimeout(80);
};

// 워커 하이라이트가 줄 DOM을 갈아 끼우는 동안 `[data-line]`의 boundingBox()가
// null이 된다. 텍스트 행의 좌표를 읽는 스펙은 색이 착지한 뒤에 진행한다.
export const waitForHighlighted = (container: Locator): Promise<void> =>
	expect
		.poll(() =>
			container.evaluate(
				(el) => el.shadowRoot?.querySelector("pre span[style]") != null,
			),
		)
		.toBe(true);
