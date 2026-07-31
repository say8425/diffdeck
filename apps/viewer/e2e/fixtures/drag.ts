// 공용 드래그 셀렉션 헬퍼: 거터 셀·텍스트 행 양쪽에서 쓰는 합성 드래그
// 제스처(`dragSelect`)와 워커 하이라이트 착지를 기다리는 폴러
// (`waitForHighlighted`). grab.e2e.ts·grab-highlight.e2e.ts가 공유한다 —
// sleep 값·40px 오프셋은 실측으로 튜닝한 값이니 재튜닝은 이 파일에서만
// 하고, 두 스펙 다 여기 값을 그대로 따르게 유지한다.
//
// 드래그 헬퍼 공통 유의사항(둘 다 실측으로 확인):
// 1. 합성 제스처(mouse.move/down/move/up)는 pollable하지 않다 — 각 단계
//    사이에 짧은 sleep을 넣지 않으면 Chrome이 mousedown 앵커를 못 잡고
//    selection이 비어버린다(steps만으로는 불충분, 실측 확인).
// 2. enableGutterUtility가 호버 중인 행 위에 20x20 "+" 버튼을 절대좌표로
//    띄우는데, 이 버튼이 행 콘텐츠 시작 지점에서 ~11px까지 겹친다. 텍스트
//    드래그의 시작 x좌표를 행 시작에서 5px만 띄우면 mousedown이 이 버튼을
//    맞혀 거터 경로로 가로채져 팝오버가 곧장 열려버린다 — 40px 이상 띄워야
//    실제 텍스트 위에서 시작한다. 텍스트 경로는 트리거 버튼 없이 pointerup
//    즉시 팝오버가 열린다(거터 "+" 경로와 동일한 즉시성).
import type { Locator, Page } from "@playwright/test";
import { expect } from "./app.ts";

/** 거터 셀·텍스트 행 공용 드래그 헬퍼: from → down → to(steps) → up. */
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

// 워커 하이라이트가 plain → 색 스팬으로 DOM을 교체하는 도중 boundingBox()를
// 읽으면 순간적으로 null이 된다(retokenize-cache 계열과 같은 근본 원인).
// 텍스트 행(gutter 셀이 아니라 [data-line])의 좌표를 읽는 스펙은 색이 실제로
// 착지한 뒤에 진행해 이 경합을 피한다.
export const waitForHighlighted = (container: Locator): Promise<void> =>
	expect
		.poll(() =>
			container.evaluate(
				(el) => el.shadowRoot?.querySelector("pre span[style]") != null,
			),
		)
		.toBe(true);
