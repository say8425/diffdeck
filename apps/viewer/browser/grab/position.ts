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
