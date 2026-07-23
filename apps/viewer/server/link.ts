export const buildDiffViewerUrl = (params: {
	port: number;
	repo: string;
	token: string;
	mode?: "working" | "base";
	untracked?: boolean;
	watch?: boolean;
	flatten?: boolean;
	treeSide?: "left" | "right";
	diffStyle?: "unified" | "split";
	treeHidden?: boolean;
	foldWithTree?: boolean;
}): string => {
	const query = new URLSearchParams({
		repo: params.repo,
		token: params.token,
	});
	if (params.mode) query.set("mode", params.mode);
	// Append view flags only when they differ from the viewer's own defaults
	// (untracked off, watch off, flatten on, tree left, style unified, sidebar
	// visible, fold-with-tree off).
	if (params.untracked) query.set("untracked", "1");
	if (params.watch) query.set("watch", "1");
	if (params.flatten === false) query.set("flatten", "0");
	if (params.treeSide === "right") query.set("tree", "right");
	if (params.diffStyle === "split") query.set("style", "split");
	if (params.treeHidden) query.set("sidebar", "0");
	if (params.foldWithTree) query.set("foldtree", "1");
	return `http://127.0.0.1:${params.port}/?${query.toString()}`;
};
