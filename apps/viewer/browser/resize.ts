import { clampTreeWidth, type TreeSide } from "./prefs.ts";

export const KEYBOARD_STEP = 10;

// treeSide flips the delta's sign: the resizer sits to the LEFT of a
// right-side tree, so moving the pointer left (negative delta) must GROW
// that tree, the mirror image of the left-side-tree case.
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
