// Reconstructed from ~/dev/cc-statusline/node_modules/@pierre/trees/dist/model/internalTypes.d.ts.
//
// The upstream @pierre/trees source maps do not contain sourcesContent for
// this file: it is a type-only module, so esbuild/tsc never emitted a
// src/model/internalTypes.js (and therefore no .js.map) to extract from.
// Recovered verbatim from the shipped .d.ts — only the `.js` import
// extensions were stripped to match this repo's extension-less imports.

import type { FileTreeIcons } from "../iconConfig";
import type { GitStatus } from "../publicTypes";
import type {
	FileTreeCompositionOptions,
	FileTreePublicId,
	FileTreeRenderOptions,
	FileTreeRowDecorationRenderer,
	FileTreeScrollOffset,
	FileTreeSearchBlurBehavior,
	FileTreeVisibleRow,
} from "./publicTypes";
import type { FileTreeController } from "./FileTreeController";

type FileTreeControllerListener = () => void;
interface FileTreeStickyRowCandidate {
	row: FileTreeVisibleRow;
	subtreeEndIndex: number;
}
interface FileTreeViewportMetrics {
	itemCount: number;
	itemHeight: number;
	overscan?: number;
	scrollTop: number;
	viewportHeight: number;
}
interface FileTreeRange {
	end: number;
	start: number;
}
interface FileTreeStickyWindowLayout {
	offsetHeight: number;
	stickyInset: number;
	totalHeight: number;
	windowHeight: number;
}
interface FileTreeScrollRequest {
	id: number;
	offset: FileTreeScrollOffset;
	visibleIndex: number;
}
interface FileTreeSlotHost {
	clearSlotContent(slotName: string): void;
	setSlotContent(slotName: string, content: HTMLElement | null): void;
}
interface FileTreeViewProps extends Omit<
	FileTreeRenderOptions,
	"initialVisibleRowCount"
> {
	composition?: FileTreeCompositionOptions;
	controller: FileTreeController;
	directoriesWithGitChanges?: ReadonlySet<FileTreePublicId>;
	gitStatusByPath?: ReadonlyMap<FileTreePublicId, GitStatus>;
	ignoredGitDirectories?: ReadonlySet<FileTreePublicId>;
	icons?: FileTreeIcons;
	initialViewportHeight?: number;
	instanceId?: string;
	renamingEnabled?: boolean;
	renderRowDecoration?: FileTreeRowDecorationRenderer;
	searchBlurBehavior?: FileTreeSearchBlurBehavior;
	searchEnabled?: boolean;
	searchFakeFocus?: boolean;
	slotHost?: FileTreeSlotHost;
}

export type {
	FileTreeControllerListener,
	FileTreeRange,
	FileTreeScrollRequest,
	FileTreeSlotHost,
	FileTreeStickyRowCandidate,
	FileTreeStickyWindowLayout,
	FileTreeViewProps,
	FileTreeViewportMetrics,
};
