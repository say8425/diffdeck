// Vanilla DOM port of the READ-ONLY branches of `renderFileTreeRowContent`
// (FileTreeView.tsx:832-913) and `renderStyledRow` (FileTreeView.tsx:987-1193).
//
// Scope: this builds static row DOM only -- no event handlers, no DnD, no
// context-menu action lane, no rename input, no sticky mirror. Those are
// either wired in a later task (event handlers) or genuinely out of scope for
// a read-only row (drag, rename, context menu, sticky virtualization mirror).
// Concretely, relative to the source:
//   - `actionLaneEnabled`/`showDecorativeActionAffordance` are hardcoded
//     false (no `data-item-section="action"` lane is ever rendered).
//   - the custom-decoration lane (`data-item-section="decoration"`, driven by
//     the caller-supplied `renderRowDecoration` render prop) is out of scope --
//     it is a config surface this task's `ctx` does not expose.
//   - `renameInput`/`dragTargetFlattenedSegmentPath` are always null, so
//     `formatFlattenedSegments`'s rename/drag-target branches collapse away.
//   - `mode` is always `"flow"` and `isParked` is always `false` (sticky rows
//     and virtualization parking are list-level concerns, not row-rendering
//     ones).
//   - drag/focus/hover interaction state (`isDragTarget`, `isDragging`,
//     `isContextHovered`, `isFocusRinged`) is hardcoded false; wiring those
//     from live interaction state is a later task.
import type { BuildIconProps } from "../components/vanillaIcon";
import { buildIcon } from "../components/vanillaIcon";
import {
	buildMiddleTruncate,
	buildTruncate,
} from "../components/vanillaOverflowText";
import type { RemappedIcon } from "../iconConfig";
import type {
	FileTreeRowDecoration,
	FileTreeVisibleRow,
} from "../model/publicTypes";
import type { GitStatus } from "../publicTypes";
import type { SVGSpriteNames } from "../sprite";
import {
	GIT_STATUS_DESCENDANT_TITLE,
	GIT_STATUS_LABEL,
	GIT_STATUS_TITLE,
} from "../utils/gitStatusPresentation";
import { el, type ElChild } from "./el";
import { createFileTreeIconResolver } from "./iconResolver";
import {
	computeFileTreeRowElementAttributes,
	type FileTreeRowFeatureFlags,
	type FileTreeRowStateFlags,
} from "./rowAttributes";

type FileTreeIconResolver = ReturnType<typeof createFileTreeIconResolver>;

// Read-only subset of FileTreeRowFeatureFlags: contextMenuEnabled/
// actionLaneEnabled (and everything derived from them) are hardcoded false in
// `buildRow` -- only gitLaneActive is a real, caller-supplied config knob.
export type FileTreeRowVanillaFeatures = {
	gitLaneActive: boolean;
};

// Read-only subset of FileTreeRowStateFlags: drag/focus-ring/context-hover are
// hardcoded false in `buildRow` (no interaction wiring yet) -- only the git
// status a row's own state actually needs comes from the caller.
export type FileTreeRowVanillaState = {
	effectiveGitStatus: GitStatus | null;
	containsGitChange: boolean;
};

export type FileTreeRowVanillaContext = {
	iconResolver: FileTreeIconResolver;
	itemHeight: number;
	features: FileTreeRowVanillaFeatures;
	state: FileTreeRowVanillaState;
	ariaLabel: string;
	domId: string | undefined;
};

// getFileTreeRowPath (FileTreeView.tsx:121-126). Exported: FileTreeVanillaView.ts
// imports this instead of keeping its own duplicate copy (Task 6 dedupe).
export const getFileTreeRowPath = (row: FileTreeVisibleRow): string =>
	row.isFlattened
		? (row.flattenedSegments?.findLast((segment) => segment.isTerminal)?.path ??
			row.path)
		: row.path;

// getBuiltInGitStatusDecoration (FileTreeView.tsx:412-436).
const getBuiltInGitStatusDecoration = (
	gitStatus: GitStatus | null,
	containsGitChange: boolean,
): FileTreeRowDecoration | null => {
	if (gitStatus != null) {
		const label = GIT_STATUS_LABEL[gitStatus];
		if (label == null) {
			return null;
		}

		return { text: label, title: GIT_STATUS_TITLE[gitStatus] };
	}

	if (containsGitChange) {
		return {
			icon: { name: "file-tree-icon-dot", width: 6, height: 6 },
			title: GIT_STATUS_DESCENDANT_TITLE,
		};
	}

	return null;
};

// isBuiltInDecorationIconName (FileTreeView.tsx:773-780).
const isBuiltInDecorationIconName = (name: string): name is SVGSpriteNames =>
	name === "file-tree-icon-chevron" ||
	name === "file-tree-icon-dot" ||
	name === "file-tree-icon-file" ||
	name === "file-tree-icon-lock";

// Icon-prop resolution half of renderRowDecoration (FileTreeView.tsx:794-805).
const resolveDecorationIconProps = (
	rawIcon: RemappedIcon,
	resolveIcon: FileTreeIconResolver["resolveIcon"],
): BuildIconProps => {
	if (typeof rawIcon === "string") {
		return isBuiltInDecorationIconName(rawIcon)
			? resolveIcon(rawIcon)
			: { name: rawIcon };
	}

	if (isBuiltInDecorationIconName(rawIcon.name)) {
		const { name: _ignoredName, ...iconOverrides } = rawIcon;
		return { ...resolveIcon(rawIcon.name), ...iconOverrides };
	}

	return rawIcon;
};

// renderRowDecoration (FileTreeView.tsx:782-811).
const buildRowDecoration = (
	decoration: FileTreeRowDecoration | null,
	resolveIcon: FileTreeIconResolver["resolveIcon"],
): HTMLElement | null => {
	if (decoration == null) {
		return null;
	}

	if ("text" in decoration) {
		return el("span", { title: decoration.title }, [decoration.text]);
	}

	return el("span", { title: decoration.title }, [
		buildIcon(resolveDecorationIconProps(decoration.icon, resolveIcon)),
	]);
};

// Read-only remainder of formatFlattenedSegments (FileTreeView.tsx:82-119):
// renameInput and dragTargetFlattenedSegmentPath are always null/absent here,
// so every segment always renders as a plain `<Truncate>`, and the
// drag-target attribute never appears.
const buildFlattenedSegments = (row: FileTreeVisibleRow): Node | string => {
	const segments = row.flattenedSegments;
	if (segments == null || segments.length === 0) {
		return row.name;
	}

	const children: ElChild[] = [];
	segments.forEach((segment, index) => {
		children.push(
			el("span", { "data-item-flattened-subitem": segment.path }, [
				buildTruncate({ children: segment.name }),
			]),
		);
		if (index < segments.length - 1) {
			children.push(" / ");
		}
	});

	return el("span", { "data-item-flattened-subitems": true }, children);
};

const buildContentLane = (row: FileTreeVisibleRow): ElChild =>
	row.isFlattened
		? buildFlattenedSegments(row)
		: buildMiddleTruncate({
				children: row.name,
				minimumLength: 5,
				split: "extension",
			});

const buildSpacingLane = (row: FileTreeVisibleRow): HTMLElement =>
	el(
		"div",
		{ "data-item-section": "spacing" },
		Array.from({ length: row.depth }, (_, index) =>
			el("div", {
				"data-item-section": "spacing-item",
				"data-ancestor-path": row.ancestorPaths[index],
			}),
		),
	);

// The section-lane portion of renderFileTreeRowContent (FileTreeView.tsx:
// 857-889, 897-901) -- spacing + icon + content + git only (see module header
// for what is dropped).
export const buildRowContent = (
	row: FileTreeVisibleRow,
	ctx: FileTreeRowVanillaContext,
): DocumentFragment => {
	const targetPath = getFileTreeRowPath(row);
	const fragment = document.createDocumentFragment();

	if (row.depth > 0) {
		fragment.appendChild(buildSpacingLane(row));
	}

	fragment.appendChild(
		el("div", { "data-item-section": "icon" }, [
			row.kind === "directory"
				? buildIcon(ctx.iconResolver.resolveIcon("file-tree-icon-chevron"))
				: buildIcon(
						ctx.iconResolver.resolveIcon("file-tree-icon-file", targetPath),
					),
		]),
	);

	fragment.appendChild(
		el("div", { "data-item-section": "content" }, [buildContentLane(row)]),
	);

	if (ctx.features.gitLaneActive) {
		const gitDecoration = getBuiltInGitStatusDecoration(
			ctx.state.effectiveGitStatus,
			ctx.state.containsGitChange,
		);
		const decorationNode = buildRowDecoration(
			gitDecoration,
			ctx.iconResolver.resolveIcon,
		);
		fragment.appendChild(
			el(
				"div",
				{ "data-item-section": "git" },
				decorationNode != null ? [decorationNode] : [],
			),
		);
	}

	return fragment;
};

// The read-only `<button role="treeitem">` branch of renderStyledRow
// (FileTreeView.tsx:1156-1192), carrying the attribute bag from
// `computeFileTreeRowElementAttributes` with `mode: "flow"` and every
// interactive feature/state flag pinned to its read-only value (see module
// header). Event handlers, the `ref` callback, and `draggable` are not part
// of the attribute bag and are intentionally never added here.
export const buildRow = (
	row: FileTreeVisibleRow,
	ctx: FileTreeRowVanillaContext,
): HTMLButtonElement => {
	const targetPath = getFileTreeRowPath(row);

	const features: FileTreeRowFeatureFlags = {
		contextMenuEnabled: false,
		actionLaneEnabled: false,
		contextMenuButtonVisibility: null,
		contextMenuTriggerMode: null,
		gitLaneActive: ctx.features.gitLaneActive,
	};
	const state: FileTreeRowStateFlags = {
		isFocusRinged: false,
		isContextHovered: false,
		isDragTarget: false,
		isDragging: false,
		effectiveGitStatus: ctx.state.effectiveGitStatus,
		containsGitChange: ctx.state.containsGitChange,
	};

	// `el()` is the single substrate for aria-*/data-* boolean stringification
	// (see el.ts), so the raw attribute bag from
	// `computeFileTreeRowElementAttributes` -- which hands some fields through
	// as booleans (`aria-expanded`, `data-item-focused`, `data-item-selected`,
	// `data-item-drag-target`, `data-item-dragging`) -- is applied directly.
	const attrs = computeFileTreeRowElementAttributes({
		row,
		mode: "flow",
		targetPath,
		ariaLabel: ctx.ariaLabel,
		domId: ctx.domId,
		isParked: false,
		itemHeight: ctx.itemHeight,
		features,
		state,
	});

	return el("button", { ...attrs, type: "button" }, [
		buildRowContent(row, ctx),
	]) as HTMLButtonElement;
};
