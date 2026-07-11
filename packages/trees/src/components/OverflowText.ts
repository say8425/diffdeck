// Pure (preact-free) half of OverflowText.tsx: the split* content-splitting
// functions plus the shared primitive types they depend on. Relocated here
// (Plan 3 de-preact, Task 2) so the vanilla view code (vanillaOverflowText.ts)
// can use them without pulling in preact. OverflowText.tsx re-exports
// everything from this module so its existing consumers keep working
// unchanged until the tsx file is deleted (Task 7).
//
// IMPORTANT: this is a relocation, not a rewrite -- the logic below is
// unmodified from components/OverflowText.tsx (formerly lines 9-187).

export type TruncateMode = "truncate" | "fruncate";

export type SplitOffsetType = "last" | "first";
export type SplitOffset = [SplitOffsetType, number];

// Structural equivalent of the original `Pick<MiddleTruncateProps, 'priority'
// | 'variant'> & { splitIndex?: number; splitOffset?: number }` -- redefined
// here without referencing MiddleTruncateProps (which is preact-shaped) so
// this module stays preact-free. `priority`/`variant` are accepted for
// interface parity with the original type but, like the original, are unused
// by the split* functions below.
export type MiddleTruncateFilteredProps = {
	priority?: "start" | "end" | "equal";
	variant?: "default" | "fade";
	splitIndex?: number;
	splitOffset?: number;
};

export type CustomSplitFn = (
	contents: string,
	props?: MiddleTruncateFilteredProps,
) => [string, string];

// When a split boundary lands adjacent to whitespace, the trailing/leading
// space sits at the seam between the two inline segments. Because the visible
// content is rendered with `white-space: nowrap`, the browser collapses that
// boundary whitespace and the name visually loses its space (e.g. "Hello world"
// rendering as "Helloworld"). To keep the space visible, nudge the proposed
// center index to the nearest position where neither side of the seam is
// whitespace, so the space stays interior to one segment. Returns the original
// index when no whitespace-free boundary exists (e.g. all-whitespace input).
const isWhitespace = (char: string | undefined): boolean =>
	char !== undefined && /\s/.test(char);

const avoidWhitespaceBoundary = (
	contents: string,
	centerIndex: number,
): number => {
	const isOnBoundary = (index: number): boolean =>
		isWhitespace(contents[index - 1]) || isWhitespace(contents[index]);

	if (!isOnBoundary(centerIndex)) {
		return centerIndex;
	}

	// Search outward from the center for the closest boundary that is not
	// adjacent to whitespace, keeping the two segments as balanced as possible.
	for (let offset = 1; offset < contents.length; offset++) {
		const before = centerIndex - offset;
		if (before > 0 && !isOnBoundary(before)) {
			return before;
		}
		const after = centerIndex + offset;
		if (after < contents.length && !isOnBoundary(after)) {
			return after;
		}
	}

	return centerIndex;
};

const centerSplitIndex = (contents: string): number =>
	avoidWhitespaceBoundary(contents, Math.ceil(contents.length / 2));

// Split the contents into two equal segments
export const splitCenter: CustomSplitFn = (contents) => {
	if (contents.length < 2) {
		return [contents, ""];
	}
	const splitIndex = centerSplitIndex(contents);
	return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

// Find the last dot in the contents and split a that index
export const splitExtension: CustomSplitFn = (contents) => {
	if (contents.length < 4) {
		return [contents, ""];
	}
	const lastDotIndex = contents.lastIndexOf(".");
	const extensionIndex = lastDotIndex + 1;
	const impliedExtensionLength = contents.length - extensionIndex;
	const maxExtensionLength = 10;
	const isTooLong = impliedExtensionLength > maxExtensionLength;

	const splitIndex =
		extensionIndex >= 1 && !isTooLong
			? extensionIndex
			: centerSplitIndex(contents);

	return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export const splitLeafPath: CustomSplitFn = (contents) => {
	if (contents.length < 4) {
		return [contents, ""];
	}
	const lastSlashIndex = contents.lastIndexOf("/");
	const leafPathIndex = lastSlashIndex + 1;
	const impliedLeafPathLength = contents.length - leafPathIndex;
	const maxLeafPathLength = 25;
	const isTooLong = impliedLeafPathLength > maxLeafPathLength;
	const splitIndex =
		leafPathIndex >= 1 && !isTooLong
			? leafPathIndex
			: Math.ceil(contents.length / 2);
	return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export const splitByIndex: CustomSplitFn = (contents, { splitIndex } = {}) => {
	if (typeof splitIndex !== "number") {
		const centerIndex = Math.ceil(contents.length / 2);
		return [contents.slice(0, centerIndex), contents.slice(centerIndex)];
	}
	return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export const splitLast: CustomSplitFn = (
	contents: string,
	{ splitOffset } = {},
) => {
	// fall back to center split if the offset is not valid
	if (
		typeof splitOffset !== "number" ||
		splitOffset <= 0 ||
		splitOffset >= contents.length
	) {
		const centerIndex = Math.ceil(contents.length / 2);
		return [contents.slice(0, centerIndex), contents.slice(centerIndex)];
	}

	const splitIndex = contents.length - splitOffset;
	return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export const splitFirst: CustomSplitFn = (
	contents: string,
	{ splitOffset } = {},
) => {
	// fall back to center split if the offset is not valid
	if (
		typeof splitOffset !== "number" ||
		splitOffset <= 0 ||
		splitOffset >= contents.length
	) {
		const centerIndex = Math.ceil(contents.length / 2);
		return [contents.slice(0, centerIndex), contents.slice(centerIndex)];
	}

	const splitIndex = splitOffset;
	return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};
