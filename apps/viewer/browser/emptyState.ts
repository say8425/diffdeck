import type { RepoSummary } from "../server/summary.ts";

export interface EmptyStateAction {
	kind: "switch-mode" | "show-untracked";
	label: string;
}

export interface EmptyStateModel {
	headline: string;
	context: string;
	actions: EmptyStateAction[];
	quietNote: string | null;
}

export interface EmptyStateHandlers {
	onSwitchMode: () => void;
	onShowUntracked: () => void;
}

export const buildEmptyStateModel = (
	summary: RepoSummary,
	opts: { mode: "working" | "base"; untrackedShown: boolean },
): EmptyStateModel => {
	const { base } = summary;
	// `null`(head가 커밋된 rev라 재지 않았다)을 `?? 0`으로 접지 않는다 — 보지도
	// 않은 워킹트리를 "Working tree clean"이라고 단언하게 된다.
	const untracked = summary.untrackedFiles;
	const headline =
		opts.mode === "working"
			? untracked === null
				? "No changes"
				: untracked > 0
					? "No tracked changes"
					: "Working tree clean"
			: base
				? `No changes vs ${base}`
				: "No changes";

	const contextParts: string[] = [];
	if (summary.branch) contextParts.push(`on ${summary.branch}`);
	else if (summary.head) contextParts.push(`detached @ ${summary.head}`);
	const ahead = summary.aheadCommits ?? 0;
	if (ahead > 0 && base) {
		contextParts.push(`${ahead} commit(s) ahead of ${base}`);
	}
	const context = contextParts.join(" · ");

	const actions: EmptyStateAction[] = [];
	const baseFiles = summary.baseFiles ?? 0;
	if (opts.mode === "working" && base && baseFiles > 0) {
		actions.push({
			kind: "switch-mode",
			label: `${baseFiles} file(s) changed vs ${base} — view`,
		});
	}
	if (!opts.untrackedShown && (summary.untrackedFiles ?? 0) > 0) {
		actions.push({
			kind: "show-untracked",
			label: `${summary.untrackedFiles} untracked file(s) hidden — show`,
		});
	}

	// 카운터가 전부 측정된 0일 때만 주장한다(`=== 0` — null은 재지 못한 값이다).
	const localQuiet = summary.workingFiles === 0 && summary.untrackedFiles === 0;
	const baseQuiet = base
		? summary.baseFiles === 0 && summary.aheadCommits === 0
		: true;
	const quietNote =
		localQuiet && baseQuiet ? "Nothing to show in any mode" : null;

	return { headline, context, actions, quietNote };
};

export const renderEmptyState = (
	doc: Document,
	model: EmptyStateModel,
	handlers: EmptyStateHandlers,
): HTMLElement => {
	const root = doc.createElement("div");
	root.id = "empty";
	root.className = "empty-card";

	const headline = doc.createElement("div");
	headline.className = "empty-headline";
	headline.textContent = model.headline;
	root.append(headline);

	if (model.context) {
		const context = doc.createElement("div");
		context.className = "empty-context";
		context.textContent = model.context;
		root.append(context);
	}

	for (const action of model.actions) {
		const button = doc.createElement("button");
		button.type = "button";
		button.className = "empty-action";
		button.textContent = action.label;
		button.addEventListener("click", () => {
			if (action.kind === "switch-mode") handlers.onSwitchMode();
			else handlers.onShowUntracked();
		});
		root.append(button);
	}

	if (model.quietNote) {
		const quiet = doc.createElement("div");
		quiet.className = "empty-quiet";
		quiet.textContent = model.quietNote;
		root.append(quiet);
	}

	return root;
};

// 판정을 따로 세우지 않고 카드의 액션을 읽는다. 사용자가 base를 고른 적
// 있거나 이 뷰에도 볼 것(untracked)이 있으면 옮기지 않는다
// (.claude/rules/viewer.md).
export const shouldAutoViewBase = (
	model: EmptyStateModel,
	opts: { hasExplicitBase: boolean; alreadyTried: boolean },
): boolean => {
	if (opts.hasExplicitBase || opts.alreadyTried) return false;
	const kinds = new Set(model.actions.map((a) => a.kind));
	return kinds.has("switch-mode") && !kinds.has("show-untracked");
};
