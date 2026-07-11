// Vanilla DOM port of the string-children half of OverflowText.tsx
// (OverflowText/Truncate/Fruncate/MiddleTruncate, components/OverflowText.tsx:229-430).
// Output must match the preact components' rendered DOM exactly -- verified by
// rendering the real components into happy-dom (see vanillaOverflowText.test.ts
// header comment and task-2-report.md).
//
// Scope note: the original `MiddleTruncateProps` also accepts a
// `contents: [ComponentChildren, ComponentChildren]` variant (pre-built preact
// nodes for the two segments, bypassing the split* functions entirely). That
// variant is preact-node-shaped and unused anywhere in this codebase (only
// the string-`children` + split* path is used by FileTreeView.tsx) -- it is
// intentionally out of scope for this vanilla port.
import { el } from "../render/el";
import {
	type CustomSplitFn,
	splitByIndex,
	splitCenter,
	splitExtension,
	splitFirst,
	splitLast,
	splitLeafPath,
	type SplitOffset,
	type TruncateMode,
} from "./OverflowText.ts";

export type OverflowTextVariant = "default" | "fade";

// Matches the original `marker` prop: a plain node (we only need strings in
// the vanilla/DOM-builder context) or a render-prop function.
export type OverflowMarkerValue =
	| string
	| ((props: { children?: string }) => Node | string);

export type BuildTruncateOpts = {
	children: string;
	marker?: OverflowMarkerValue;
	variant?: OverflowTextVariant;
	className?: string;
	style?: Record<string, string | undefined>;
};

export type BuildMiddleTruncateOpts = {
	children: string;
	priority?: "start" | "end" | "equal";
	split?:
		| "center"
		| "extension"
		| "leaf-path"
		| number
		| SplitOffset
		| CustomSplitFn;
	minimumLength?: number;
	marker?: OverflowMarkerValue;
	variant?: OverflowTextVariant;
	className?: string;
	style?: Record<string, string | undefined>;
};

// OverflowContent (OverflowText.tsx:211-227): the inner span wrapper is only
// needed to implement the right-aligned internals for fruncate.
const buildOverflowContent = (
	mode: TruncateMode,
	children: string,
): HTMLElement => {
	const isFruncate = mode === "fruncate";
	const visibleChild: Node | string = isFruncate
		? el("span", {}, [children])
		: children;
	const overflowChild: Node | string = isFruncate
		? el("span", {}, [children])
		: children;
	return el("div", {}, [
		el("div", { "data-truncate-content": "visible" }, [visibleChild]),
		el("div", { "data-truncate-content": "overflow", "aria-hidden": "true" }, [
			overflowChild,
		]),
	]);
};

// OverflowMarker (OverflowText.tsx:189-209).
const buildOverflowMarker = (
	marker: OverflowMarkerValue,
	variant: OverflowTextVariant,
): HTMLElement => {
	const isFadeVariant = variant === "fade";
	const markerChildren: (Node | string)[] = [];
	if (typeof marker === "function") {
		// The original call site (`<OverflowMarker marker={marker} mode={mode}
		// variant={variant} />`) never actually passes `children` through, so the
		// render-prop always sees `children: undefined` -- faithfully preserved.
		markerChildren.push(marker({ children: undefined }));
	} else if (isFadeVariant) {
		markerChildren.push(el("span", { "data-truncate-fade": "true" }));
	} else if (marker !== "") {
		// Empty-string markers (MiddleTruncate's "simple" segment override)
		// render no child at all, matching preact skipping falsy JSX children.
		markerChildren.push(marker);
	}
	return el(
		"div",
		{ "aria-hidden": "true", "data-truncate-marker-cell": "true" },
		[el("div", { "data-truncate-marker": "true" }, markerChildren)],
	);
};

// OverflowText (OverflowText.tsx:229-265): shared core for Truncate/Fruncate.
const buildOverflowTextCore = (
	mode: TruncateMode,
	opts: BuildTruncateOpts,
): HTMLElement => {
	const {
		children,
		marker = "…",
		variant = "default",
		className,
		style,
	} = opts;
	const contentNode = buildOverflowContent(mode, children);
	const markerNode = buildOverflowMarker(marker, variant);
	const gridChildren =
		mode === "truncate"
			? [contentNode, markerNode]
			: [markerNode, contentNode, el("div", { "data-truncate-fill": "true" })];

	return el(
		"div",
		{
			"data-truncate-container": mode,
			"data-truncate-variant": variant,
			class: className,
			style,
		},
		[el("div", { "data-truncate-grid": "true" }, gridChildren)],
	);
};

// Truncate (OverflowText.tsx:267-277).
export const buildTruncate = (opts: BuildTruncateOpts): HTMLElement =>
	buildOverflowTextCore("truncate", opts);

// Fruncate (OverflowText.tsx:279-289). Not part of this task's public
// interface (only buildTruncate/buildMiddleTruncate are), kept internal for
// buildMiddleTruncate's second segment; promote to an export if a later task
// needs a standalone right-aligned segment.
const buildFruncate = (opts: BuildTruncateOpts): HTMLElement =>
	buildOverflowTextCore("fruncate", opts);

// MiddleTruncate (OverflowText.tsx:291-430), string-`children` path only (see
// module-level scope note).
export const buildMiddleTruncate = (
	opts: BuildMiddleTruncateOpts,
): HTMLElement => {
	const {
		children,
		priority = "end",
		split = "center",
		minimumLength = 12,
		className,
		style,
		marker,
		variant,
	} = opts;

	// In case styling relies on the presence of the component, return a bare div.
	if (children.length === 0) {
		return el("div", { class: className, style });
	}

	// Below minimumLength: still truncate the text, but don't split it into
	// two segments.
	if (children.length < minimumLength) {
		if (priority === "end") {
			return buildFruncate({ children, marker, variant, className, style });
		}
		// 'start' and 'equal' both fall back to standard end-clipping.
		return buildTruncate({ children, marker, variant, className, style });
	}

	let splitFn: CustomSplitFn | null = null;
	let splitIndex: number | undefined;
	let splitOffset: number | undefined;

	// A little ugly, but want to make it fast?
	if (typeof split === "string") {
		if (split === "center") {
			splitFn = splitCenter;
		} else if (split === "extension") {
			splitFn = splitExtension;
		} else if (split === "leaf-path") {
			splitFn = splitLeafPath;
		}
	} else if (typeof split === "number") {
		splitFn = splitByIndex;
		splitIndex = split;
	} else if (Array.isArray(split)) {
		const [offsetType, offsetValue] = split;
		splitOffset = offsetValue;
		if (offsetType === "last") {
			splitFn = splitLast;
		} else if (offsetType === "first") {
			splitFn = splitFirst;
		}
	} else if (typeof split === "function") {
		splitFn = split;
	}

	// If we can't determine the split function, use the center split.
	splitFn ??= splitCenter;

	const [firstHalfMessage, secondHalfMessage] = splitFn(children, {
		priority,
		variant,
		splitIndex,
		splitOffset,
	});

	const firstIsLarger = firstHalfMessage.length >= secondHalfMessage.length;
	const secondIsLarger = !firstIsLarger;

	const firstCanBeSimple = priority === "equal" && secondIsLarger;
	const secondCanBeSimple = priority === "equal" && firstIsLarger;

	const firstSegment = buildTruncate({
		children: firstHalfMessage,
		marker: firstCanBeSimple ? "" : marker,
		variant,
	});
	const secondSegment = buildFruncate({
		children: secondHalfMessage,
		marker: secondCanBeSimple ? "" : marker,
		variant,
	});

	return el(
		"div",
		{ "data-truncate-group-container": "middle", class: className, style },
		[
			el(
				"div",
				{
					"data-truncate-segment-priority":
						priority === "start" || priority === "equal" ? "1" : "2",
				},
				[firstSegment],
			),
			el(
				"div",
				{
					"data-truncate-segment-priority":
						priority === "end" || priority === "equal" ? "1" : "2",
				},
				[secondSegment],
			),
		],
	);
};
