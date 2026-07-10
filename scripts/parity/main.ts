// Render-parity harness: proves the forked @diffdeck/diffs (CodeView,
// parseDiffFromFile) and @diffdeck/trees (FileTree) construct and render a
// fixed diff + tree end-to-end, using the same construction shape and
// options as cc-statusline's production viewer
// (~/dev/cc-statusline/src/viewer/main.ts lines ~190-336). This harness
// intentionally omits cc-statusline's interactive chrome (find bar, watch
// polling, fold persistence, image cards, copy button) — those migrate to
// diffdeck in a later plan. Only the CodeView + FileTree construction and a
// single static render pass are mirrored here.
import { CodeView, parseDiffFromFile } from "@diffdeck/diffs";
import { FileTree } from "@diffdeck/trees";
import fixture from "./fixture.json";

interface FixtureFile {
	name: string;
	status: "added" | "deleted" | "modified" | "renamed" | "untracked";
	binary: boolean;
	oldContents: string;
	newContents: string;
}

const files = fixture as FixtureFile[];

const treeMount = document.getElementById("tree") as HTMLElement;
const diffMount = document.getElementById("diff") as HTMLElement;

const paths = files.map((f) => f.name);
const gitStatus = files.map((f) => ({ path: f.name, status: f.status }));

// Declared before FileTree so onSelectionChange (which only fires later, on
// user interaction) always closes over an initialized CodeView — mirrors the
// mutable-binding pattern in cc-statusline's viewer/main.ts rather than
// relying on a forward reference to a later `const`.
let codeView: CodeView;

const fileTree = new FileTree({
	paths,
	gitStatus,
	initialExpansion: "open",
	flattenEmptyDirectories: true,
	onSelectionChange: (selected) => {
		const path = selected[0];
		if (path) codeView.scrollTo({ type: "item", id: path });
	},
});
fileTree.render({ containerWrapper: treeMount });

// Fixture is small and pre-ordered, so the harness skips cc-statusline's
// tree-order comparator (sortFilesLikeTree) — that comparator is
// consumer-side glue, not part of what this harness needs to prove about
// the fork itself.
const items = files.map((f) => ({
	id: f.name,
	type: "diff" as const,
	fileDiff: parseDiffFromFile(
		{ name: f.name, contents: f.oldContents },
		{ name: f.name, contents: f.newContents },
	),
	version: 0,
	collapsed: false,
}));

codeView = new CodeView({
	diffStyle: "unified",
	themeType: "dark",
	stickyHeaders: true,
	hunkSeparators: "line-info",
	expansionLineCount: 10,
	collapsedContextThreshold: 3,
	expandUnchanged: false,
});
codeView.setup(diffMount);
codeView.setItems(items);
codeView.render();

requestAnimationFrame(() => {
	codeView.render();
	requestAnimationFrame(() => codeView.render());
});
