// getInheritedIgnoredGitStatus (FileTreeView.tsx:438-462), ported verbatim
// for FileTreeVanillaView's row git-status resolution (Task 6 of Plan 3,
// de-preact). A row with no directly-set git status inherits "ignored" from
// the nearest ignored ancestor directory; this walk is memoized into
// `ignoredInheritanceCache` (created once per `renderRows()` pass in
// FileTreeVanillaView.ts) so repeated ancestor path prefixes shared by
// sibling rows are not re-walked from scratch.
import type { GitStatus } from "../publicTypes";

export function getInheritedIgnoredGitStatus(
	ancestorPaths: readonly string[],
	ignoredDirectoryPaths: ReadonlySet<string> | undefined,
	ignoredInheritanceCache: Map<string, boolean>,
): GitStatus | null {
	if (ignoredDirectoryPaths == null || ignoredDirectoryPaths.size === 0) {
		return null;
	}

	const visitedAncestors: string[] = [];
	for (let index = ancestorPaths.length - 1; index >= 0; index -= 1) {
		const ancestorPath = ancestorPaths[index];
		const cached = ignoredInheritanceCache.get(ancestorPath);
		if (cached != null) {
			for (const visitedAncestor of visitedAncestors) {
				ignoredInheritanceCache.set(visitedAncestor, cached);
			}
			return cached ? "ignored" : null;
		}

		if (ignoredDirectoryPaths.has(ancestorPath)) {
			ignoredInheritanceCache.set(ancestorPath, true);
			for (const visitedAncestor of visitedAncestors) {
				ignoredInheritanceCache.set(visitedAncestor, true);
			}
			return "ignored";
		}

		visitedAncestors.push(ancestorPath);
	}

	for (const visitedAncestor of visitedAncestors) {
		ignoredInheritanceCache.set(visitedAncestor, false);
	}

	return null;
}
