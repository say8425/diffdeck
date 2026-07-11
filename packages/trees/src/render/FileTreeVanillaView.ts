// Vanilla DOM container view for `FileTreeController`. Builds a static
// (non-virtualized) row list host, subscribes to the controller, and rebuilds
// every visible row on each controller emit via `buildRow`
// (render/renderRowVanilla.ts -- the read-only `<button role=treeitem>` row
// renderer ported in Task 3). This is Task 4 of Plan 3 (de-preact): container
// + subscription + row rebuild only.
//
// Explicitly out of scope here (see docs/superpowers/plans/2026-07-11-diffdeck-de-preact.md,
// Task 4 vs Task 5/6/7):
//   - virtualization: `renderRows()` always asks the controller for the full
//     visible range (`getVisibleRows(0, getVisibleCount() - 1)`).
//   - event handlers (click/keyboard/focus-in): Task 5 wires interaction on
//     top of the DOM this task builds. The search `<input>` built in `mount()`
//     is an unwired scaffold -- no `input`/`blur`/`focus` listeners yet.
//   - DnD, rename, sticky rows, SSR/hydration: not read-only-row concerns.
//   - git-status wiring: `buildRow`'s `ctx.features.gitLaneActive` and
//     `ctx.state.{effectiveGitStatus,containsGitChange}` are real,
//     caller-supplied knobs per renderRowVanilla.ts's own module header, but
//     nothing in this task's test surface exercises git status, and porting
//     `getInheritedIgnoredGitStatus`'s ignored-directory inheritance
//     (FileTreeView.tsx:438-460) without a test to drive it would be scope
//     creep past "container + subscription + row rebuild". Mirroring Task 3's
//     own hardcoding of drag/focus/context-hover row state, every row's git
//     ctx is hardcoded to "no git status" here; a later task threads real
//     `gitStatusByPath`/`ignoredGitDirectories`/`directoriesWithGitChanges`
//     props through once something (the Task 6 viewer-contract test's
//     `setGitStatus` assertion) actually needs it end to end.
import type { FileTreeIcons } from "../iconConfig";
import type { FileTreeController } from "../model/FileTreeController";
import type { FileTreeVisibleRow } from "../model/publicTypes";
import { el } from "./el";
import { createFileTreeIconResolver } from "./iconResolver";
import { buildRow, type FileTreeRowVanillaContext } from "./renderRowVanilla";

export type FileTreeVanillaViewProps = {
	controller: FileTreeController;
	itemHeight: number;
	icons?: FileTreeIcons;
	searchEnabled?: boolean;
	instanceId?: string;
};

// getFileTreeRowPath (FileTreeView.tsx:121-126), duplicated locally the same
// way renderRowVanilla.ts already duplicates it (see that file's own copy) --
// `domId` computation below needs the flattened-aware target path
// independently of `buildRow`'s internal copy.
const getFileTreeRowPath = (row: FileTreeVisibleRow): string =>
	row.isFlattened
		? (row.flattenedSegments?.findLast((segment) => segment.isTerminal)?.path ??
			row.path)
		: row.path;

// getFileTreeRowAriaLabel (FileTreeView.tsx:128-135).
const getFileTreeRowAriaLabel = (row: FileTreeVisibleRow): string => {
	const flattenedSegments = row.flattenedSegments;
	if (flattenedSegments == null || flattenedSegments.length === 0) {
		return row.name;
	}

	return flattenedSegments.map((segment) => segment.name).join(" / ");
};

// getFileTreeFocusedRowDomId (FileTreeView.tsx:761-770), always called with
// `parked: false` here -- sticky-row parking is not a concern for this
// non-virtualized, read-only view.
const getFileTreeFocusedRowDomId = (
	instanceId: string | undefined,
	path: string,
): string | undefined =>
	instanceId == null
		? undefined
		: `${instanceId}__focused-item-${encodeURIComponent(path)}`;

// getFileTreeRootDomId (FileTreeView.tsx:753-757).
const getFileTreeRootDomId = (
	instanceId: string | undefined,
): string | undefined =>
	instanceId == null ? undefined : `${instanceId}__tree`;

export class FileTreeVanillaView {
	readonly #controller: FileTreeController;
	readonly #itemHeight: number;
	readonly #iconResolver: ReturnType<typeof createFileTreeIconResolver>;
	readonly #searchEnabled: boolean;
	readonly #instanceId: string | undefined;
	#root: HTMLElement | undefined;
	#list: HTMLElement | undefined;
	#unsubscribe: (() => void) | null = null;

	public constructor(props: FileTreeVanillaViewProps) {
		this.#controller = props.controller;
		this.#itemHeight = props.itemHeight;
		this.#iconResolver = createFileTreeIconResolver(props.icons);
		this.#searchEnabled = props.searchEnabled === true;
		this.#instanceId = props.instanceId;
	}

	// Builds the host/list DOM (+ optional search input), subscribes to the
	// controller, and renders the initial row set. `controller.subscribe`
	// invokes its listener synchronously once on subscribe (see
	// `FileTreeController.subscribe`), so the single `subscribe()` call below
	// both performs the initial row render and wires up every later rebuild --
	// no separate initial `renderRows()` call is needed.
	public mount(host: HTMLElement): void {
		this.unmount();

		const list = el("div", { "data-file-tree-virtualized-list": "true" });
		const scroll = el("div", { "data-file-tree-virtualized-scroll": "true" }, [
			list,
		]);
		const children = this.#searchEnabled
			? [this.#buildSearchContainer(), scroll]
			: [scroll];
		const root = el(
			"div",
			{
				role: "tree",
				tabIndex: -1,
				"data-file-tree-virtualized-root": "true",
				id: getFileTreeRootDomId(this.#instanceId),
			},
			children,
		);

		host.replaceChildren(root);
		this.#root = root;
		this.#list = list;
		this.#unsubscribe = this.#controller.subscribe(() => {
			this.renderRows();
		});
	}

	// Rebuilds every visible row into the inner list element via a full
	// `replaceChildren`. Deliberately operates on `#list` (nested inside the
	// scroll container built in `mount()`), never on the scroll container
	// itself or the root -- both of those stay the same DOM node across
	// rebuilds, so the scroll container's own `scrollTop` is left untouched.
	public renderRows(): void {
		const list = this.#list;
		if (list == null) {
			return;
		}

		const rows = this.#controller.getVisibleRows(
			0,
			this.#controller.getVisibleCount() - 1,
		);
		list.replaceChildren(
			...rows.map((row) => buildRow(row, this.#buildRowContext(row))),
		);
	}

	public unmount(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		this.#root?.remove();
		this.#root = undefined;
		this.#list = undefined;
	}

	#buildSearchContainer(): HTMLElement {
		return el("div", { "data-file-tree-search-container": "true" }, [
			el("input", {
				"data-file-tree-search-input": "true",
				placeholder: "Search…",
			}),
		]);
	}

	#buildRowContext(row: FileTreeVisibleRow): FileTreeRowVanillaContext {
		const targetPath = getFileTreeRowPath(row);
		return {
			iconResolver: this.#iconResolver,
			itemHeight: this.#itemHeight,
			ariaLabel: getFileTreeRowAriaLabel(row),
			domId: row.isFocused
				? getFileTreeFocusedRowDomId(this.#instanceId, targetPath)
				: undefined,
			features: { gitLaneActive: false },
			state: { effectiveGitStatus: null, containsGitChange: false },
		};
	}
}
