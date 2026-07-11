// Vanilla DOM container view for `FileTreeController`. Builds a static
// (non-virtualized) row list host, subscribes to the controller, rebuilds
// every visible row on each controller emit via `buildRow`
// (render/renderRowVanilla.ts -- the read-only `<button role=treeitem>` row
// renderer ported in Task 3), and wires read-only interaction on top of that
// DOM -- Task 5 of Plan 3 (de-preact).
//
// Interaction is wired via THREE delegated listeners on the root
// (`click`/`keydown`/`focusin`), never per-row -- `event.target.closest(
// "[data-item-path]")` identifies the row, the same delegation shape the
// viewer's own diff-fold handler uses. This ports the read-only subset of
// `handleRowClick` (FileTreeView.tsx:3513-3591) and `handleTreeKeyDown`
// (FileTreeView.tsx:2157-2454):
//   - click: `computeFileTreeRowClickPlan` (./rowClickPlan.ts) turns the
//     click's modifiers + directory-ness into a plan, dispatched to
//     `selectPathRange`/`togglePathSelectionFromInput`/
//     `selectOnlyMountedPathFromInput` for selection,
//     `toggleMountedDirectoryFromInput` for directory toggling, and
//     `closeSearch` when the plan says so. `mode` is always `"flow"` here (no
//     sticky rows in this non-virtualized view), so `plan.revealCanonical` is
//     always false and is never acted on.
//   - keydown: ArrowDown/Up/Home/End move focus; ArrowRight/Left
//     expand/collapse a focused directory or move to the next/parent item;
//     shift+ArrowDown/Up extends the selection from the focused row (source
//     :2310-2312). Enter/Space are deliberately NOT special-cased: `buildRow`
//     renders a real `<button>`, and activating a focused native button with
//     Enter/Space already fires a real, trusted `click` event carrying the
//     live modifier keys (spec'd browser behavior) -- which the delegated
//     click listener above handles identically to a mouse click. Adding an
//     explicit Enter/Space branch here would double-handle that click in a
//     real browser. (The source `handleTreeKeyDown` has no such branch
//     either -- it relies on the same native behavior; happy-dom does not
//     simulate it, which is why this task's own tests never assert on
//     Enter/Space.)
//   - focusin: syncs controller focus to whatever row DOM focus lands on,
//     delegating the per-row `onFocus` at FileTreeView.tsx:1140-1144.
//   - after any focus-moving controller call (click or keydown), DOM focus is
//     imperatively moved to the now-focused row's button via `focusElement`
//     (./focusHelpers.ts). This view has no virtualization, so the focused
//     row's button always already exists in the DOM -- no scroll-into-view
//     bookkeeping is needed here, unlike the source's scroll-aware
//     DOM-focus-sync effect.
//   - search `<input>` (built in Task 4, previously unwired): `input` ->
//     `controller.setSearch(value)`; `Escape` (handled in the same delegated
//     keydown listener, gated on `event.target` being the search input) ->
//     `controller.closeSearch()`. The full `isSearchOpen` keydown branch
//     (Enter-to-select-and-close-search, ArrowUp/Down-to-search-match) is
//     NOT ported -- out of this task's "click/keyboard/selection/search"
//     scope.
//   - `onSelectionChange` fires from the same controller subscription that
//     drives `renderRows()`, gated on `getSelectionVersion()` actually
//     changing -- mirrors `FileTree.#emitSelectionChange` (FileTree.ts:
//     583-596).
//
// Explicitly out of scope here (see docs/superpowers/plans/2026-07-11-diffdeck-de-preact.md,
// Task 5 vs Task 6/7):
//   - virtualization: `renderRows()` always asks the controller for the full
//     visible range (`getVisibleRows(0, getVisibleCount() - 1)`) -- Task 4's
//     scope, unchanged here.
//   - DnD, rename (F2), sticky rows / the sticky-keyboard-stack branches
//     (source :2416+), and the context menu: none of `handleRowClick`'s or
//     `handleTreeKeyDown`'s branches for these are ported (read-only
//     interaction only).
//   - `ctrl/cmd+Space` (`toggleFocusedSelection`) and `ctrl/cmd+A`
//     (`selectAllVisiblePaths`) are real `handleTreeKeyDown` branches but are
//     not part of this task's scope; nothing in this task's test surface
//     exercises them.
//   - git-status wiring: unchanged from Task 4 -- every row's git ctx is
//     still hardcoded to "no git status" (see `#buildRowContext` below).
import type { FileTreeIcons } from "../iconConfig";
import type { FileTreeController } from "../model/FileTreeController";
import type {
	FileTreeDirectoryHandle,
	FileTreeItemHandle,
	FileTreeSelectionChangeListener,
	FileTreeVisibleRow,
} from "../model/publicTypes";
import { el } from "./el";
import { focusElement } from "./focusHelpers";
import { createFileTreeIconResolver } from "./iconResolver";
import { buildRow, type FileTreeRowVanillaContext } from "./renderRowVanilla";
import { computeFileTreeRowClickPlan } from "./rowClickPlan";

export type FileTreeVanillaViewProps = {
	controller: FileTreeController;
	itemHeight: number;
	icons?: FileTreeIcons;
	searchEnabled?: boolean;
	instanceId?: string;
	onSelectionChange?: FileTreeSelectionChangeListener;
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

// isFileTreeDirectoryHandle (FileTreeView.tsx:476-480).
const isFileTreeDirectoryHandle = (
	item: FileTreeItemHandle | null,
): item is FileTreeDirectoryHandle => item != null && "toggle" in item;

export class FileTreeVanillaView {
	readonly #controller: FileTreeController;
	readonly #itemHeight: number;
	readonly #iconResolver: ReturnType<typeof createFileTreeIconResolver>;
	readonly #searchEnabled: boolean;
	readonly #instanceId: string | undefined;
	readonly #onSelectionChange: FileTreeSelectionChangeListener | undefined;
	#root: HTMLElement | undefined;
	#list: HTMLElement | undefined;
	#searchInput: HTMLInputElement | undefined;
	#unsubscribe: (() => void) | null = null;
	#selectionVersion: number;

	public constructor(props: FileTreeVanillaViewProps) {
		this.#controller = props.controller;
		this.#itemHeight = props.itemHeight;
		this.#iconResolver = createFileTreeIconResolver(props.icons);
		this.#searchEnabled = props.searchEnabled === true;
		this.#instanceId = props.instanceId;
		this.#onSelectionChange = props.onSelectionChange;
		this.#selectionVersion = this.#controller.getSelectionVersion();
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
		root.addEventListener("click", this.#handleClick);
		root.addEventListener("keydown", this.#handleKeyDown);
		root.addEventListener("focusin", this.#handleFocusIn);
		this.#searchInput?.addEventListener("input", this.#handleSearchInput);
		this.#unsubscribe = this.#controller.subscribe(() => {
			this.renderRows();
			this.#emitSelectionChange();
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
		this.#root?.removeEventListener("click", this.#handleClick);
		this.#root?.removeEventListener("keydown", this.#handleKeyDown);
		this.#root?.removeEventListener("focusin", this.#handleFocusIn);
		this.#searchInput?.removeEventListener("input", this.#handleSearchInput);
		this.#root?.remove();
		this.#root = undefined;
		this.#list = undefined;
		this.#searchInput = undefined;
	}

	#buildSearchContainer(): HTMLElement {
		const input = el("input", {
			"data-file-tree-search-input": "true",
			placeholder: "Search…",
		}) as HTMLInputElement;
		this.#searchInput = input;
		return el("div", { "data-file-tree-search-container": "true" }, [input]);
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

	// The read-only subset of `handleRowClick` (FileTreeView.tsx:3513-3591) --
	// see the module header for exactly what is ported vs dropped.
	#handleClick = (event: MouseEvent): void => {
		const target = event.target;
		const rowElement =
			target instanceof Element ? target.closest("[data-item-path]") : null;
		if (!(rowElement instanceof HTMLElement)) {
			return;
		}

		const targetPath = rowElement.getAttribute("data-item-path");
		if (targetPath == null) {
			return;
		}

		const isDirectory = rowElement.getAttribute("data-item-type") === "folder";
		const plan = computeFileTreeRowClickPlan({
			event: {
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				shiftKey: event.shiftKey,
			},
			isDirectory,
			isSearchOpen: this.#controller.isSearchOpen(),
			mode: "flow",
		});

		const shouldToggleDirectory = plan.toggleDirectory && isDirectory;
		const mountedDirectoryPath = shouldToggleDirectory
			? this.#controller.resolveMountedDirectoryPathFromInput(targetPath)
			: null;
		if (shouldToggleDirectory && mountedDirectoryPath == null) {
			return;
		}

		const actionTargetPath = mountedDirectoryPath ?? targetPath;
		switch (plan.selection.kind) {
			case "range":
				this.#controller.selectPathRange(
					actionTargetPath,
					plan.selection.additive,
				);
				break;
			case "toggle":
				this.#controller.togglePathSelectionFromInput(actionTargetPath);
				break;
			case "single":
				this.#controller.selectOnlyMountedPathFromInput(actionTargetPath);
				break;
		}

		this.#controller.focusMountedPathFromInput(actionTargetPath);
		if (shouldToggleDirectory) {
			this.#controller.toggleMountedDirectoryFromInput(actionTargetPath);
		}
		if (plan.closeSearch) {
			this.#controller.closeSearch();
		}
		this.#moveDomFocusToFocusedRow();
	};

	// The read-only subset of `handleTreeKeyDown` (FileTreeView.tsx:2157-2454)
	// -- see the module header for exactly what is ported vs dropped (no
	// sticky-stack branches, no F2/rename, no DnD, no Enter/Space).
	#handleKeyDown = (event: KeyboardEvent): void => {
		if (event.target === this.#searchInput) {
			if (event.key === "Escape") {
				this.#controller.closeSearch();
			}
			return;
		}

		const focusedItem = this.#controller.getFocusedItem();
		if (focusedItem == null) {
			return;
		}

		const focusedDirectoryItem = isFileTreeDirectoryHandle(focusedItem)
			? focusedItem
			: null;
		let handled = true;
		if (event.shiftKey && event.key === "ArrowDown") {
			this.#controller.extendSelectionFromFocused(1);
		} else if (event.shiftKey && event.key === "ArrowUp") {
			this.#controller.extendSelectionFromFocused(-1);
		} else {
			switch (event.key) {
				case "ArrowDown":
					this.#controller.focusNextItem();
					break;
				case "ArrowUp":
					this.#controller.focusPreviousItem();
					break;
				case "ArrowRight":
					if (
						focusedDirectoryItem == null ||
						focusedDirectoryItem.isExpanded()
					) {
						this.#controller.focusNextItem();
					} else {
						focusedDirectoryItem.expand();
					}
					break;
				case "ArrowLeft":
					if (
						focusedDirectoryItem != null &&
						focusedDirectoryItem.isExpanded()
					) {
						focusedDirectoryItem.collapse();
					} else {
						this.#controller.focusParentItem();
					}
					break;
				case "Home":
					this.#controller.focusFirstItem();
					break;
				case "End":
					this.#controller.focusLastItem();
					break;
				default:
					handled = false;
			}
		}

		if (!handled) {
			return;
		}

		event.preventDefault();
		this.#moveDomFocusToFocusedRow();
	};

	// focusin delegate for the per-row `onFocus` at FileTreeView.tsx:1140-1144.
	#handleFocusIn = (event: FocusEvent): void => {
		const target = event.target;
		const rowElement =
			target instanceof Element ? target.closest("[data-item-path]") : null;
		if (!(rowElement instanceof HTMLElement)) {
			return;
		}

		const path = rowElement.getAttribute("data-item-path");
		if (path == null) {
			return;
		}

		this.#controller.focusMountedPathFromInput(path);
	};

	#handleSearchInput = (): void => {
		this.#controller.setSearch(this.#searchInput?.value ?? "");
	};

	// Mirrors `FileTree.#emitSelectionChange` (FileTree.ts:583-596): fires on
	// every controller emit, gated on `getSelectionVersion()` actually having
	// changed so unrelated emits (a focus move, a row toggle) do not fire it.
	#emitSelectionChange(): void {
		const onSelectionChange = this.#onSelectionChange;
		if (onSelectionChange == null) {
			return;
		}

		const nextSelectionVersion = this.#controller.getSelectionVersion();
		if (nextSelectionVersion === this.#selectionVersion) {
			return;
		}

		this.#selectionVersion = nextSelectionVersion;
		onSelectionChange(this.#controller.getSelectedPaths());
	}

	// No virtualization means the focused row's button is always already in
	// the DOM (see module header) -- this just has to find it and hand it to
	// `focusElement`.
	#moveDomFocusToFocusedRow(): void {
		const path = this.#controller.getFocusedPath();
		if (path == null) {
			return;
		}

		focusElement(this.#findRowElement(path));
	}

	#findRowElement(path: string): HTMLElement | null {
		const list = this.#list;
		if (list == null) {
			return null;
		}

		for (const child of Array.from(list.children)) {
			if (
				child instanceof HTMLElement &&
				child.getAttribute("data-item-path") === path
			) {
				return child;
			}
		}

		return null;
	}
}
