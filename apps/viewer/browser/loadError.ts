export type LoadFailure =
	| { kind: "network" }
	// 재시도 뒤에도 503(서버 flight 타임아웃).
	| { kind: "busy" }
	// marker는 `x-diff-error` 헤더다.
	| { kind: "http"; status: number; marker: string | null; body: string };

export type LoadErrorActionKind = "retry" | "view-working-tree" | "drop-base";

export interface LoadErrorModel {
	headline: string;
	/** 사용자가 알아볼 사실(경로, ref 이름). */
	context: string;
	/** 빠져나갈 길 — 버튼으로 줄 수 없을 때만. */
	note: string | null;
	action: { kind: LoadErrorActionKind; label: string } | null;
	// 툴바 `#status` 문구. diff가 떠 있으면 카드를 못 그려서 이유가 여기에만
	// 남는다.
	status: string;
}

export interface LoadErrorContext {
	repo: string;
	head: string | null;
	base: string;
}

const RETRY = { kind: "retry", label: "Try again" } as const;
const BODY_LIMIT = 200;

const failed = (reason: string): string => `Failed to load diff: ${reason}`;

const byMarker = (
	marker: string,
	ctx: LoadErrorContext,
): LoadErrorModel | null => {
	switch (marker) {
		case "no-repo":
			return {
				headline: "No repository in this link",
				context: "The URL has no repo parameter",
				note: "Open the viewer by running diffdeck inside a git repository.",
				action: null,
				status: failed("no repository"),
			};
		case "repo-missing":
			return {
				headline: "That folder doesn't exist",
				context: ctx.repo,
				note: "It may have been deleted or moved — a removed worktree, for example.",
				action: null,
				status: failed("folder not found"),
			};
		case "not-a-repo":
			return {
				headline: "Not a git repository",
				context: ctx.repo,
				note: "Run diffdeck inside a git repository, or point repo= in the URL at one.",
				action: null,
				status: failed("not a git repository"),
			};
		case "no-worktree":
			return {
				headline: "This repository has no working tree",
				context: ctx.repo,
				note: "Bare repositories and .git folders can't be diffed — open one of its worktrees.",
				action: null,
				status: failed("no working tree"),
			};
		case "unsafe-repo":
			return {
				headline: "git refuses to open this repository",
				context: ctx.repo,
				note: "It's owned by another user. If you trust it: git config --global --add safe.directory <path>",
				action: RETRY,
				status: failed("repository not trusted by git"),
			};
		case "git-unavailable":
			return {
				headline: "Couldn't run git",
				context: "The server failed to start git",
				note: "Check that git is installed. If the folder diffdeck started in was deleted, restart diffdeck.",
				action: RETRY,
				status: failed("git unavailable"),
			};
		case "unknown-head":
			return {
				headline: "That branch is gone",
				context: `No ref named ${ctx.head ?? ""} in this repo`,
				note: null,
				action: {
					kind: "view-working-tree",
					label: "View the working tree instead",
				},
				status: failed("branch not found"),
			};
		case "unknown-base":
			return {
				headline: "That base is gone",
				context: `No ref named ${ctx.base} to compare against`,
				note: null,
				// "default"를 약속하지 않는다 — URL의 base만 걷으므로 저장된
				// 프리퍼런스가 이길 수 있다.
				action: {
					kind: "drop-base",
					label: `Remove ${ctx.base} from this link`,
				},
				status: failed("base not found"),
			};
		default:
			return null;
	}
};

export const buildLoadErrorModel = (
	failure: LoadFailure,
	ctx: LoadErrorContext,
): LoadErrorModel => {
	if (failure.kind === "network") {
		return {
			headline: "Can't reach the diffdeck server",
			context: "It may have been stopped",
			note: "Start diffdeck again, then retry.",
			action: RETRY,
			status: failed("server unreachable"),
		};
	}
	if (failure.kind === "busy") {
		return {
			headline: "The server is taking too long",
			context: "Building this diff didn't finish in time",
			note: null,
			action: RETRY,
			status: failed("server busy"),
		};
	}
	const known = failure.marker ? byMarker(failure.marker, ctx) : null;
	if (known) return known;
	if (failure.status === 403) {
		return {
			headline: "This link's access token was rejected",
			context: "Another diffdeck may be on this port, or its token changed",
			note: "Open the viewer again from diffdeck to get a fresh link.",
			action: null,
			status: failed("access denied"),
		};
	}
	// 모르는 실패도 서버가 준 말은 전한다.
	const body = failure.body.trim().slice(0, BODY_LIMIT);
	return {
		headline: "Failed to load diff",
		context: body
			? `The server answered ${failure.status}: ${body}`
			: `The server answered ${failure.status}`,
		note: null,
		action: RETRY,
		status: failed(`HTTP ${failure.status}`),
	};
};

// watch 폴이 같은 실패를 되풀이할 때 카드를 다시 그리지 않으려고 쓴다(다시
// 그리면 버튼 포커스가 날아간다).
export const loadErrorKey = (model: LoadErrorModel): string =>
	`${model.headline}\n${model.context}`;

export const renderLoadError = (
	doc: Document,
	model: LoadErrorModel,
	onAction: (kind: LoadErrorActionKind) => void,
): HTMLElement => {
	const root = doc.createElement("div");
	// id "empty"는 계약이다 — 빈 리포에서 서버가 돌아오면 304라 enrichEmptyState가
	// #empty를 갈아 끼우는 것으로만 복구된다.
	root.id = "empty";
	root.className = "empty-card";
	root.setAttribute("data-load-error", loadErrorKey(model));
	// 빈 상태와 달리 일어난 일의 통지라 alert로 알린다.
	root.setAttribute("role", "alert");

	const headline = doc.createElement("div");
	headline.className = "empty-headline";
	headline.textContent = model.headline;
	root.append(headline);

	const context = doc.createElement("div");
	context.className = "empty-context";
	context.textContent = model.context;
	root.append(context);

	if (model.action) {
		const { kind, label } = model.action;
		const button = doc.createElement("button");
		button.type = "button";
		button.className = "empty-action";
		button.textContent = label;
		button.addEventListener("click", () => onAction(kind));
		root.append(button);
	}

	if (model.note) {
		const note = doc.createElement("div");
		note.className = "empty-quiet";
		note.textContent = model.note;
		root.append(note);
	}

	return root;
};
