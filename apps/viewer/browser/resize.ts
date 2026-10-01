import { clampTreeWidth, type TreeSide } from "./prefs.ts";

export const KEYBOARD_STEP = 10;

// A right-side tree's resizer sits on its left edge, so dragging left
// (negative delta) grows it.
export const computeDragWidth = (
	startWidth: number,
	startX: number,
	currentX: number,
	treeSide: TreeSide,
): number => {
	const delta = currentX - startX;
	return clampTreeWidth(
		treeSide === "right" ? startWidth - delta : startWidth + delta,
	);
};

export const computeKeyboardWidth = (
	current: number,
	direction: -1 | 1,
): number => clampTreeWidth(current + direction * KEYBOARD_STEP);
