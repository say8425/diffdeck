// Reconstructed from usage across packages/path-store/src/*.ts.
//
// The upstream @pierre/trees source maps do not contain sourcesContent for
// this file: it is a type-only module, so esbuild/tsc never emitted a
// path-store/src/public-types.js (and therefore no .js.map) to extract from.
// Every type below was inferred from how it is constructed and consumed in
// the recovered implementation files (builder.ts, canonical.ts, events.ts,
// projection.ts, state.ts, static-store.ts, store.ts, cleanup.ts, sort.ts,
// options.ts, internal-types.ts).

export interface PathStoreCompareEntry {
	basename: string;
	depth: number;
	isDirectory: boolean;
	path: string;
	segments: readonly string[];
}

export type PathStorePathComparator = (
	left: PathStoreCompareEntry,
	right: PathStoreCompareEntry,
) => number;

export interface PathStoreOptions {
	flattenEmptyDirectories?: boolean;
	sort?: "default" | PathStorePathComparator;
}

export type PathStoreInitialExpansion = "closed" | "open" | number;

// Opaque prepared-input marker returned by PathStore.prepareInput() /
// PathStore.preparePresortedInput(). Internal-types.ts's InternalPreparedInput
// intersects this with private fields (preparedPaths, presortedPaths,
// presortedPathsContainDirectories) that only builder.ts reads back out via
// an unsafe cast.
export interface PathStorePreparedInput {
	readonly paths: readonly string[];
}

export interface PathStoreConstructorOptions extends PathStoreOptions {
	initialExpandedPaths?: readonly string[];
	initialExpansion?: PathStoreInitialExpansion;
	paths?: readonly string[];
	preparedInput?: PathStorePreparedInput;
	presorted?: boolean;
}

export type PathStoreCollisionStrategy = "error" | "replace" | "skip";

export interface PathStoreMoveOptions {
	collision?: PathStoreCollisionStrategy;
}

export interface PathStoreRemoveOptions {
	recursive?: boolean;
}

export type PathStoreDirectoryLoadState =
	| "error"
	| "loaded"
	| "loading"
	| "unloaded";

export interface PathStoreLoadAttempt {
	attemptId: number;
	nodeId: number;
	reused: boolean;
}

export type PathStoreCleanupMode = "aggressive" | "stable";

export interface PathStoreCleanupOptions {
	mode?: PathStoreCleanupMode;
}

export interface PathStoreCleanupResult {
	activeNodeCountAfter: number;
	activeNodeCountBefore: number;
	cachedPathEntryCountAfter: number;
	cachedPathEntryCountBefore: number;
	idsPreserved: boolean;
	loadInfoEntryCountAfter: number;
	loadInfoEntryCountBefore: number;
	mode: PathStoreCleanupMode;
	reclaimedCachedPathEntryCount: number;
	reclaimedLoadInfoEntryCount: number;
	reclaimedNodeSlotCount: number;
	reclaimedSegmentCount: number;
	segmentCountAfter: number;
	segmentCountBefore: number;
	totalNodeSlotCountAfter: number;
	totalNodeSlotCountBefore: number;
}

export interface PathStorePathInfo {
	depth: number;
	kind: "directory" | "file";
	path: string;
}

export type PathStoreOperation =
	| { type: "add"; path: string }
	| { type: "remove"; path: string; recursive?: boolean }
	| {
			type: "move";
			from: string;
			to: string;
			collision?: PathStoreCollisionStrategy;
	  };

export interface PathStoreChildPatch {
	operations: readonly PathStoreOperation[];
}

interface PathStoreEventBase {
	affectedAncestorIds: readonly number[];
	affectedNodeIds: readonly number[];
	canonicalChanged: boolean;
	projectionChanged: boolean;
	visibleCountDelta: number | null;
}

export interface PathStoreAddEvent extends PathStoreEventBase {
	operation: "add";
	path: string;
}

export interface PathStoreRemoveEvent extends PathStoreEventBase {
	operation: "remove";
	path: string;
	recursive: boolean;
}

export interface PathStoreMoveEvent extends PathStoreEventBase {
	from: string;
	operation: "move";
	to: string;
}

export interface PathStoreExpandEvent extends PathStoreEventBase {
	operation: "expand";
	path: string;
}

export interface PathStoreCollapseEvent extends PathStoreEventBase {
	operation: "collapse";
	path: string;
}

export interface PathStoreMarkDirectoryUnloadedEvent extends PathStoreEventBase {
	operation: "mark-directory-unloaded";
	path: string;
}

export interface PathStoreBeginChildLoadEvent extends PathStoreEventBase {
	attemptId: number;
	operation: "begin-child-load";
	path: string;
	reused: boolean;
}

export interface PathStoreApplyChildPatchEvent extends PathStoreEventBase {
	attemptId: number;
	childEvents: readonly PathStoreSemanticEvent[];
	operation: "apply-child-patch";
	path: string;
}

export interface PathStoreCompleteChildLoadEvent extends PathStoreEventBase {
	attemptId: number;
	operation: "complete-child-load";
	path: string;
	stale: boolean;
}

export interface PathStoreFailChildLoadEvent extends PathStoreEventBase {
	attemptId: number;
	errorMessage: string | undefined;
	operation: "fail-child-load";
	path: string;
	stale: boolean;
}

export interface PathStoreCleanupEvent
	extends PathStoreEventBase, PathStoreCleanupResult {
	operation: "cleanup";
}

export interface PathStoreBatchEvent extends PathStoreEventBase {
	events: readonly PathStoreSemanticEvent[];
	operation: "batch";
}

export type PathStoreSemanticEvent =
	| PathStoreAddEvent
	| PathStoreApplyChildPatchEvent
	| PathStoreBeginChildLoadEvent
	| PathStoreCleanupEvent
	| PathStoreCollapseEvent
	| PathStoreCompleteChildLoadEvent
	| PathStoreExpandEvent
	| PathStoreFailChildLoadEvent
	| PathStoreMarkDirectoryUnloadedEvent
	| PathStoreMoveEvent
	| PathStoreRemoveEvent;

export type PathStoreEvent = PathStoreBatchEvent | PathStoreSemanticEvent;

export type PathStoreEventType = PathStoreEvent["operation"];

export type PathStoreEventForType<TType extends PathStoreEventType | "*"> =
	TType extends "*"
		? PathStoreEvent
		: Extract<PathStoreEvent, { operation: TType }>;

export interface PathStoreFlattenedSegment {
	isTerminal: boolean;
	name: string;
	nodeId: number;
	path: string;
}

export interface PathStoreVisibleRow {
	depth: number;
	flattenedSegments: readonly PathStoreFlattenedSegment[] | undefined;
	hasChildren: boolean;
	id: number;
	isExpanded: boolean;
	isFlattened: boolean;
	isLoading: boolean;
	kind: "directory" | "file";
	loadState: PathStoreDirectoryLoadState | undefined;
	name: string;
	path: string;
}

export interface PathStoreVisibleAncestorRow {
	ancestorPaths: readonly string[];
	index: number;
	posInSet: number;
	row: PathStoreVisibleRow;
	setSize: number;
	subtreeEndIndex: number;
}

export interface PathStoreVisibleRowContext {
	ancestorPaths: readonly string[];
	ancestorRows: readonly PathStoreVisibleAncestorRow[];
	index: number;
	posInSet: number;
	row: PathStoreVisibleRow;
	setSize: number;
	subtreeEndIndex: number;
}

export interface PathStoreVisibleTreeProjectionData {
	getParentIndex: (index: number) => number;
	paths: readonly string[];
	posInSetByIndex: Int32Array;
	setSizeByIndex: Int32Array;
	readonly visibleIndexByPath: Map<string, number>;
}

export interface PathStoreVisibleTreeProjectionRow {
	index: number;
	parentPath: string | null;
	path: string;
	posInSet: number;
	setSize: number;
}

export interface PathStoreVisibleTreeProjection {
	getParentIndex: (index: number) => number;
	rows: readonly PathStoreVisibleTreeProjectionRow[];
	readonly visibleIndexByPath: Map<string, number>;
}
