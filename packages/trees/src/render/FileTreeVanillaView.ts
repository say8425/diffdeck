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
//     :2310-2312); ctrl/cmd+Space toggles the focused path's selection
//     (`toggleFocusedSelection`) and ctrl/cmd+A selects every visible path
//     (`selectAllVisiblePaths`), matching the source's un-gated dispatch
//     (:2334-2340). `event.stopPropagation()` is called alongside
//     `preventDefault()` on every handled key, matching the source. Enter/
//     Space are deliberately NOT special-cased: `buildRow`
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
//     `controller.setSearch(value)`. The full read-only `isSearchOpen`
//     keydown branch is ported (FileTreeView.tsx:2196-2236, minus the
//     scroll-restoration bookkeeping noted below): while
//     `controller.isSearchOpen()` is true, `Escape` -> `closeSearch()`;
//     `Enter` -> `selectOnlyPath(focusedPath)` + `closeSearch()`;
//     `ArrowDown`/`ArrowUp` -> `focusNextSearchMatch()`/
//     `focusPreviousSearchMatch()` (instead of the plain focus-prev/next-item
//     used when search is closed). This is checked first in `#handleKeyDown`,
//     regardless of `event.target`, matching the source (which gates purely
//     on `isSearchOpen`, not on where DOM focus is). When search is CLOSED
//     and a row has keyboard focus, typing a single printable character
//     (`isSearchOpenSeedKey`, FileTreeView.tsx:488-496, replicated locally)
//     opens+seeds search via `controller.openSearch(key)` and moves DOM
//     focus to the search input (FileTreeView.tsx:2238-2244).
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
//
// git-status wiring (Task 6): `#buildRowContext` computes each row's
// `effectiveGitStatus`/`containsGitChange` from the `gitStatusByPath`/
// `ignoredGitDirectories`/`directoriesWithGitChanges` maps the caller passes
// in (mirrors renderFileTreeRow, FileTreeView.tsx:1025-1038, including
// "ignored" inheritance from the nearest ignored ancestor directory via
// `getInheritedIgnoredGitStatus`, ported to `./gitInheritance.ts`).
// `features.gitLaneActive` mirrors the source's FileTreeView.tsx:1490-1493
// gate exactly: the git lane renders whenever ANY of the three git props was
// passed (even an empty map/set), not only when a row actually has a status.
import type { FileTreeIcons } from "../iconConfig";
import type { FileTreeController } from "../model/FileTreeController";
import type {
	FileTreeDirectoryHandle,
	FileTreeItemHandle,
	FileTreePublicId,
	FileTreeSelectionChangeListener,
	FileTreeVisibleRow,
} from "../model/publicTypes";
import type { GitStatus } from "../publicTypes";
import { el } from "./el";
import { focusElement } from "./focusHelpers";
import { getInheritedIgnoredGitStatus } from "./gitInheritance";
import { createFileTreeIconResolver } from "./iconResolver";
import {
	buildRow,
	type FileTreeRowVanillaContext,
	getFileTreeRowPath,
} from "./renderRowVanilla";
import { computeFileTreeRowClickPlan } from "./rowClickPlan";

export type FileTreeVanillaViewProps = {
	controller: FileTreeController;
	itemHeight: number;
	icons?: FileTreeIcons;
	searchEnabled?: boolean;
	instanceId?: string;
	onSelectionChange?: FileTreeSelectionChangeListener;
	directoriesWithGitChanges?: ReadonlySet<FileTreePublicId>;
	gitStatusByPath?: ReadonlyMap<FileTreePublicId, GitStatus>;
	ignoredGitDirectories?: ReadonlySet<FileTreePublicId>;
};

// The subset of git-status state `setGitStatus` swaps in place -- mirrors the
// three git props above so `FileTree` can pass the same shape it stores on
// `#gitStatusState` (render/FileTree.ts).
export type FileTreeVanillaViewGitStatus = Pick<
	FileTreeVanillaViewProps,
	"directoriesWithGitChanges" | "gitStatusByPath" | "ignoredGitDirectories"
>;

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

// isSpaceSelectionKey (FileTreeView.tsx:482-486).
const isSpaceSelectionKey = (event: KeyboardEvent): boolean =>
	event.code === "Space" || event.key === " " || event.key === "Spacebar";

// isSearchOpenSeedKey (FileTreeView.tsx:488-496).
const isSearchOpenSeedKey = (event: KeyboardEvent): boolean =>
	event.key.length === 1 &&
	/^[\p{L}\p{N}]$/u.test(event.key) &&
	!event.ctrlKey &&
	!event.metaKey &&
	!event.altKey;

export class FileTreeVanillaView {
	readonly #controller: FileTreeController;
	readonly #itemHeight: number;
	#iconResolver: ReturnType<typeof createFileTreeIconResolver>;
	readonly #searchEnabled: boolean;
	readonly #instanceId: string | undefined;
	readonly #onSelectionChange: FileTreeSelectionChangeListener | undefined;
	#directoriesWithGitChanges: ReadonlySet<FileTreePublicId> | undefined;
	#gitStatusByPath: ReadonlyMap<FileTreePublicId, GitStatus> | undefined;
	#ignoredGitDirectories: ReadonlySet<FileTreePublicId> | undefined;
	#root: HTMLElement | undefined;
	#list: HTMLElement | undefined;
	#searchInput: HTMLInputElement | undefined;
	#unsubscribe: (() => void) | null = null;
	// True between pointerdown and pointerup on the tree. While set, focusin must
	// NOT drive a controller focus update: that emit rebuilds every row
	// (renderRows -> replaceChildren) synchronously between the click's mousedown
	// and mouseup, detaching the pressed <button> so the browser never fires
	// `click` -- which reads to the user as "must double-click to select". The
	// click handler sets focus + selection itself, so skipping focusin is safe.
	#pointerInteracting = false;
	#selectionVersion: number;

	public constructor(props: FileTreeVanillaViewProps) {
		this.#controller = props.controller;
		this.#itemHeight = props.itemHeight;
		this.#iconResolver = createFileTreeIconResolver(props.icons);
		this.#searchEnabled = props.searchEnabled === true;
		this.#instanceId = props.instanceId;
		this.#onSelectionChange = props.onSelectionChange;
		this.#directoriesWithGitChanges = props.directoriesWithGitChanges;
		this.#gitStatusByPath = props.gitStatusByPath;
		this.#ignoredGitDirectories = props.ignoredGitDirectories;
		this.#selectionVersion = this.#controller.getSelectionVersion();
	}

	// In-place git-status swap: updates the stored maps only -- callers rebuild
	// rows afterward via `renderRows()` (mirrors `FileTree.#syncGitStatusToView`,
	// render/FileTree.ts), so a caller-driven `resetPaths()` + `setGitStatus()`
	// sequence never resets scroll/selection.
	public setGitStatus(gitStatus: FileTreeVanillaViewGitStatus): void {
		this.#directoriesWithGitChanges = gitStatus.directoriesWithGitChanges;
		this.#gitStatusByPath = gitStatus.gitStatusByPath;
		this.#ignoredGitDirectories = gitStatus.ignoredGitDirectories;
	}

	// In-place icon-resolver swap for `FileTree#setIcons` -- callers rebuild
	// rows afterward via `renderRows()`.
	public setIcons(icons?: FileTreeIcons): void {
		this.#iconResolver = createFileTreeIconResolver(icons);
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
		root.addEventListener("pointerdown", this.#handlePointerDown);
		root.addEventListener("pointerup", this.#handlePointerUp);
		root.addEventListener("pointercancel", this.#handlePointerUp);
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
		// One inheritance cache per render pass -- see `#buildRowContext` below
		// for why this view scopes it per-pass rather than per-instance like the
		// source's `useMemo` (FileTreeView.tsx:1285).
		const ignoredInheritanceCache = new Map<string, boolean>();
		list.replaceChildren(
			...rows.map((row) =>
				buildRow(row, this.#buildRowContext(row, ignoredInheritanceCache)),
			),
		);
	}

	public unmount(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		this.#root?.removeEventListener("click", this.#handleClick);
		this.#root?.removeEventListener("keydown", this.#handleKeyDown);
		this.#root?.removeEventListener("focusin", this.#handleFocusIn);
		this.#root?.removeEventListener("pointerdown", this.#handlePointerDown);
		this.#root?.removeEventListener("pointerup", this.#handlePointerUp);
		this.#root?.removeEventListener("pointercancel", this.#handlePointerUp);
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

	// effectiveGitStatus/containsGitChange mirrors renderFileTreeRow
	// (FileTreeView.tsx:1025-1038): a row's own `gitStatusByPath` entry wins;
	// absent that, "ignored" inherits from the nearest ignored ancestor
	// directory via `getInheritedIgnoredGitStatus`, memoized into the
	// `ignoredInheritanceCache` `renderRows()` created for this pass (NOT a
	// cache scoped to the view instance like the source's `useMemo` -- this
	// view already rebuilds every row on every controller emit, so a fresh
	// per-pass cache is simpler than invalidating a longer-lived one whenever
	// `ignoredGitDirectories` changes underneath it via `setGitStatus`).
	#buildRowContext(
		row: FileTreeVisibleRow,
		ignoredInheritanceCache: Map<string, boolean>,
	): FileTreeRowVanillaContext {
		const targetPath = getFileTreeRowPath(row);
		const ownGitStatus = this.#gitStatusByPath?.get(targetPath) ?? null;
		const effectiveGitStatus =
			ownGitStatus ??
			getInheritedIgnoredGitStatus(
				row.ancestorPaths,
				this.#ignoredGitDirectories,
				ignoredInheritanceCache,
			);
		const containsGitChange =
			row.kind === "directory" &&
			(this.#directoriesWithGitChanges?.has(targetPath) ?? false);
		return {
			iconResolver: this.#iconResolver,
			itemHeight: this.#itemHeight,
			ariaLabel: getFileTreeRowAriaLabel(row),
			domId: row.isFocused
				? getFileTreeFocusedRowDomId(this.#instanceId, targetPath)
				: undefined,
			features: { gitLaneActive: this.#isGitLaneActive() },
			state: { effectiveGitStatus, containsGitChange },
		};
	}

	// gitLaneActive (FileTreeView.tsx:1490-1493).
	#isGitLaneActive(): boolean {
		return (
			this.#gitStatusByPath != null ||
			this.#ignoredGitDirectories != null ||
			this.#directoriesWithGitChanges != null
		);
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
	// sticky-stack branches, no F2/rename, no DnD, no context menu, no
	// Enter/Space). Checked first, regardless of `event.target`: while
	// `controller.isSearchOpen()` is true every keydown routes through
	// `#handleSearchOpenKeyDown` instead of the branches below, matching the
	// source gating purely on `isSearchOpen` (FileTreeView.tsx:2196).
	#handleKeyDown = (event: KeyboardEvent): void => {
		if (this.#controller.isSearchOpen()) {
			this.#handleSearchOpenKeyDown(event);
			return;
		}

		if (event.target === this.#searchInput) {
			return;
		}

		if (this.#searchEnabled && isSearchOpenSeedKey(event)) {
			this.#controller.openSearch(event.key);
			event.preventDefault();
			event.stopPropagation();
			focusElement(this.#searchInput ?? null);
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
		} else if ((event.ctrlKey || event.metaKey) && isSpaceSelectionKey(event)) {
			this.#controller.toggleFocusedSelection();
		} else if (
			(event.ctrlKey || event.metaKey) &&
			event.key.toLowerCase() === "a"
		) {
			this.#controller.selectAllVisiblePaths();
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
		event.stopPropagation();
		this.#moveDomFocusToFocusedRow();
	};

	// The read-only subset of the `isSearchOpen` keydown branch
	// (FileTreeView.tsx:2196-2236). The source's scroll-restoration
	// bookkeeping around Enter (`restoreTreeFocusAfterSearchCloseRef`,
	// `restoreTreeFocusViewportOffsetRef`) is dropped for the same reason
	// noted in the module header: this non-virtualized view has no
	// scroll-into-view bookkeeping to preserve. `Escape` deliberately does
	// NOT move DOM focus back to a row afterward -- it only closes search,
	// mirroring the source explicitly clearing
	// `restoreTreeFocusAfterSearchCloseRef` on that branch.
	#handleSearchOpenKeyDown(event: KeyboardEvent): void {
		let shouldSyncDomFocus = true;
		if (event.key === "Escape") {
			this.#controller.closeSearch();
			shouldSyncDomFocus = false;
		} else if (event.key === "Enter") {
			const focusedPath = this.#controller.getFocusedPath();
			if (focusedPath != null) {
				this.#controller.selectOnlyPath(focusedPath);
			}
			this.#controller.closeSearch();
		} else if (event.key === "ArrowDown") {
			this.#controller.focusNextSearchMatch();
		} else if (event.key === "ArrowUp") {
			this.#controller.focusPreviousSearchMatch();
		} else {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		if (shouldSyncDomFocus) {
			this.#moveDomFocusToFocusedRow();
		}
	}

	// focusin delegate for the per-row `onFocus` at FileTreeView.tsx:1140-1144.
	#handlePointerDown = (): void => {
		this.#pointerInteracting = true;
	};

	#handlePointerUp = (): void => {
		this.#pointerInteracting = false;
	};

	#handleFocusIn = (event: FocusEvent): void => {
		// A pointer-driven focusin arrives mid-click (between mousedown and
		// mouseup). Driving controller focus here rebuilds every row and detaches
		// the pressed button, swallowing the click (see `#pointerInteracting`).
		// The click handler sets focus itself, so skip. Keyboard/programmatic
		// focus (no pointer down) still updates focus normally.
		if (this.#pointerInteracting) {
			return;
		}
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
