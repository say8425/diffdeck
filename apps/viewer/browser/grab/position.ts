// 트리거/팝오버 공용 fixed 배치. 숫자 전용(순수) — happy-dom은 rect가 전부 0이라
// rect 읽기를 main.ts에 두고 여기는 게이트 안에서 전 분기를 테이블 테스트한다.

export interface AnchorRect {
	left: number;
	top: number;
	bottom: number;
}

export interface BoxSize {
	width: number;
	height: number;
}

export interface Viewport {
	width: number;
	height: number;
}

export interface Placement {
	left: number;
	top: number;
}

const GAP = 6;
const MARGIN = 8;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

export const computePlacement = (
	anchor: AnchorRect,
	size: BoxSize,
	viewport: Viewport,
): Placement => {
	let top = anchor.bottom + GAP;
	if (top + size.height > viewport.height - MARGIN)
		top = anchor.top - size.height - GAP;
	return {
		left: clamp(anchor.left, MARGIN, viewport.width - size.width - MARGIN),
		top: clamp(top, MARGIN, viewport.height - size.height - MARGIN),
	};
};
