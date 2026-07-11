/** @jsxImportSource preact */

import type { ComponentChildren, CSSProperties, JSX } from "preact";
import type {
	CustomSplitFn,
	SplitOffset,
	TruncateMode,
} from "./OverflowText.ts";
import {
	splitByIndex,
	splitCenter,
	splitExtension,
	splitFirst,
	splitLast,
	splitLeafPath,
} from "./OverflowText.ts";

// Pure split* functions + their primitive types were relocated to
// OverflowText.ts (Plan 3 de-preact, Task 2) so vanilla view code can use
// them without a preact import. Re-exported (using the local bindings
// imported above, so this file's own MiddleTruncate body keeps working) so
// existing consumers of this module are unaffected; this tsx file is deleted
// in Task 7.
//
// NOTE: the `.ts` extension above is required, not stylistic. Both `tsc`
// (moduleResolution: bundler) and bun's own bundler resolve the extensionless
// specifier `./OverflowText` differently -- tsc picks the sibling
// `OverflowText.ts` file (breaking FileTreeView.tsx's import of `MiddleTruncate`/
// `Truncate`), while bun's bundler resolves it back to *this* file, producing
// a self-import cycle (`error: Detected cycle while resolving import
// "splitCenter"`, verified via `bun run apps/viewer/build.ts`). The explicit
// extension removes the ambiguity for both toolchains.
export type {
	TruncateMode,
	SplitOffsetType,
	SplitOffset,
	MiddleTruncateFilteredProps,
	CustomSplitFn,
} from "./OverflowText.ts";
export {
	splitByIndex,
	splitCenter,
	splitExtension,
	splitFirst,
	splitLast,
	splitLeafPath,
};

type PropsWithChildren<T = {}> = T & {
	children?: ComponentChildren;
};

export type CSSPropertiesWithVars = CSSProperties & {
	[key: `--${string}`]: string | number | undefined;
};

export interface MarkerProps extends PropsWithChildren {}

export interface OverflowTextProps extends PropsWithChildren {
	mode?: TruncateMode;
	style?: Omit<CSSPropertiesWithVars, "height" | "overflow">;
	className?: string;
	marker?: ComponentChildren | ((props: MarkerProps) => ComponentChildren);
	variant?: "default" | "fade";
}

export type MiddleTruncateProps = Omit<OverflowTextProps, "mode" | "children"> &
	AllowableContentGroups & {
		minimumLength?: number;
		priority?: "start" | "end" | "equal";
		split?:
			| "center"
			| "extension"
			| "leaf-path"
			| number
			| SplitOffset
			| CustomSplitFn;
	};

type AllowableContentGroups =
	| {
			children?: never;
			contents: [ComponentChildren, ComponentChildren];
	  }
	| {
			contents?: never;
			children: string;
	  };

function OverflowMarker({
	children,
	marker,
	variant = "default",
}: OverflowTextProps) {
	"use no memo";
	const isFadeVariant = variant === "fade";
	return (
		<div aria-hidden data-truncate-marker-cell>
			<div data-truncate-marker>
				{typeof marker === "function" ? (
					marker({ children })
				) : isFadeVariant ? (
					<span data-truncate-fade />
				) : (
					marker
				)}
			</div>
		</div>
	);
}

function OverflowContent(options: OverflowTextProps) {
	"use no memo";
	const { mode, children } = options;

	// The inner span wrapper here is only needed to implement
	// the right aligned internals for fruncate
	return (
		<div>
			<div data-truncate-content="visible">
				{mode === "fruncate" ? <span>{children}</span> : children}
			</div>
			<div data-truncate-content="overflow" aria-hidden>
				{mode === "fruncate" ? <span>{children}</span> : children}
			</div>
		</div>
	);
}

export function OverflowText({
	children,
	mode = "truncate",
	marker = "…",
	variant = "default",
	...props
}: OverflowTextProps): JSX.Element {
	"use no memo";
	const contentNode = (
		<OverflowContent key="content" mode={mode}>
			{children}
		</OverflowContent>
	);
	const markerNode = (
		<OverflowMarker
			key="marker"
			marker={marker}
			mode={mode}
			variant={variant}
		/>
	);
	const fillNode = <div key="fill" data-truncate-fill></div>;

	return (
		<div
			data-truncate-container={mode}
			data-truncate-variant={variant}
			{...props}
		>
			<div data-truncate-grid>
				{mode === "truncate"
					? [contentNode, markerNode]
					: [markerNode, contentNode, fillNode]}
			</div>
		</div>
	);
}

export function Truncate({
	children,
	...props
}: Omit<OverflowTextProps, "mode">): JSX.Element {
	"use no memo";
	return (
		<OverflowText mode="truncate" {...props}>
			{children}
		</OverflowText>
	);
}

export function Fruncate({
	children,
	...props
}: Omit<OverflowTextProps, "mode">): JSX.Element {
	"use no memo";
	return (
		<OverflowText mode="fruncate" {...props}>
			{children}
		</OverflowText>
	);
}

export function MiddleTruncate({
	children,
	contents,
	priority = "end",
	split = "center",
	minimumLength = 12,
	className,
	style,
	...props
}: MiddleTruncateProps): JSX.Element | null {
	"use no memo";
	let firstSegment: ComponentChildren | null = null;
	let secondSegment: ComponentChildren | null = null;
	if (Array.isArray(contents)) {
		if (contents.length !== 2) {
			console.error("MiddleTruncate: contents must be an array of two items");
			return null;
		}
		firstSegment = <Truncate {...props}>{contents[0]}</Truncate>;
		secondSegment = <Fruncate {...props}>{contents[1]}</Fruncate>;
	} else {
		// TODO: figure out how to support ReactNode children in the future
		if (typeof children !== "string") {
			console.error("MiddleTruncate: children must be a string");
			return null;
		}

		// In case styling relies on the presence of the component, we will return a div
		if (children.length === 0) {
			return <div className={className} style={style}></div>;
		}

		// If the minimumLength is not met, we will still truncate the text,
		// but we will not split it into two segments.
		if (children.length < minimumLength) {
			if (priority === "end") {
				return (
					<Fruncate {...props} className={className} style={style}>
						{children}
					</Fruncate>
				);
			} else {
				// 'start' and 'equal' both fall back to standard end-clipping.
				return (
					<Truncate {...props} className={className} style={style}>
						{children}
					</Truncate>
				);
			}
		}

		let splitFn: CustomSplitFn | null = null;
		let splitIndex: number | null = null;
		let splitOffset: number | null = null;

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

		// If we can't determine the split function, use the center split
		splitFn ??= splitCenter;

		const [firstHalfMessage, secondHalfMessage] = splitFn(children, {
			priority,
			variant: props.variant,
			splitIndex: typeof splitIndex === "number" ? splitIndex : undefined,
			splitOffset: typeof splitOffset === "number" ? splitOffset : undefined,
		});

		const firstIsLarger = firstHalfMessage.length >= secondHalfMessage.length;
		const secondIsLarger = !firstIsLarger;

		const firstCanBeSimple = priority === "equal" && secondIsLarger;
		const secondCanBeSimple = priority === "equal" && firstIsLarger;

		const firstPropOverrides: Partial<OverflowTextProps> = {};
		const secondPropOverrides: Partial<OverflowTextProps> = {};

		if (firstCanBeSimple) {
			firstPropOverrides.marker = "";
		}
		if (secondCanBeSimple) {
			secondPropOverrides.marker = "";
		}

		firstSegment = (
			<Truncate {...props} {...firstPropOverrides}>
				{firstHalfMessage}
			</Truncate>
		);
		secondSegment = (
			<Fruncate {...props} {...secondPropOverrides}>
				{secondHalfMessage}
			</Fruncate>
		);
	}

	return (
		<div
			data-truncate-group-container="middle"
			className={className}
			style={style}
		>
			<div
				data-truncate-segment-priority={
					priority === "start" || priority === "equal" ? "1" : "2"
				}
			>
				{firstSegment}
			</div>
			<div
				data-truncate-segment-priority={
					priority === "end" || priority === "equal" ? "1" : "2"
				}
			>
				{secondSegment}
			</div>
		</div>
	);
}
