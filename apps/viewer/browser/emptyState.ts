import type { RepoSummary } from "../server/summary.ts";

/**
 * 빈 diff 화면의 정보형 빈 상태. buildEmptyStateModel이 요약 + 현재 뷰 상태를
 * 표시 모델로 접고(순수 — 유닛 테스트 대상), renderEmptyState가 그것을 DOM으로
 * 편다. main.ts는 배선만 담당한다 (prefs.ts와 같은 분리 패턴).
 */
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
	const headline =
		opts.mode === "working"
			? "Working tree clean"
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
	if (!opts.untrackedShown && summary.untrackedFiles > 0) {
		actions.push({
			kind: "show-untracked",
			label: `${summary.untrackedFiles} untracked file(s) hidden — show`,
		});
	}

	const allQuiet =
		summary.workingFiles === 0 &&
		baseFiles === 0 &&
		summary.untrackedFiles === 0 &&
		ahead === 0;
	const quietNote = allQuiet
		? base
			? `Branch matches ${base} — nothing to show in any mode`
			: "Nothing to show in any mode"
		: null;

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
