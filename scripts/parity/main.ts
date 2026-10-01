// Render-parity harness: renders a fixed fixture with the forked CodeView + FileTree for
// eyeballing before/after (.claude/rules/vendored-packages.md).
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

// Declared before FileTree so onSelectionChange closes over it.
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

// No tree-order comparator for the diff list: that is consumer-side glue, not
// something this harness proves about the fork.
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
