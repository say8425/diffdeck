/**
 * diff를 못 불러왔을 때의 카드. 예전엔 사라진 head 하나만 전용 카드가 있고
 * 나머지 전부 — 서버가 꺼졌든, 홈 디렉토리를 열었든, 토큰이 틀렸든 — 가
 * `Failed to load diff.` 한 줄이었다. 서버는 이유를 알고 있었는데(`not a git
 * repository`) 화면이 그걸 버렸다.
 *
 * emptyState.ts와 같은 분리다: buildLoadErrorModel이 실패를 표시 모델로
 * 접고(순수 — 유닛 테스트 대상), renderLoadError가 DOM으로 편다. 카드는 빈
 * 상태 카드와 **같은 클래스**를 쓴다 — 새 어휘를 만들 이유가 없다.
 */

/** fetchDiff가 마지막으로 만난 실패. */
export type LoadFailure =
	// fetch 자체가 throw — 서버가 꺼졌거나 포트가 닫혔다.
	| { kind: "network" }
	// 503을 재시도까지 받았다 — single-flight 타임아웃(server.ts).
	| { kind: "busy" }
	// 그 밖의 non-ok. marker는 `x-diff-error` 헤더다.
	| { kind: "http"; status: number; marker: string | null; body: string };

export type LoadErrorActionKind = "retry" | "view-working-tree" | "drop-base";

export interface LoadErrorModel {
	headline: string;
	/** 무엇이 문제인가 — 경로나 ref 이름처럼 사용자가 알아볼 사실. */
	context: string;
	/** 어떻게 빠져나가는가. 버튼으로 줄 수 없는 길일 때만. */
	note: string | null;
	action: { kind: LoadErrorActionKind; label: string } | null;
	/**
	 * 툴바 `#status` 문구. 이미 diff가 떠 있으면 카드를 못 그리므로(CodeView
	 * 컨테이너를 덮어쓰면 안 된다 — .claude/rules/viewer.md) 이유는 여기에만 남는다.
	 */
	status: string;
}

export interface LoadErrorContext {
	repo: string;
	/** 지금 URL의 head. unknown-head 카드가 이름을 말한다. */
	head: string | null;
	/** 지금 견주는 기준(compareBase). unknown-base 카드가 이름을 말한다. */
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
				// 버튼은 URL의 base만 걷는다 — 그러면 저장된 프리퍼런스가 있으면
				// 그것이, 없으면 자동 해석이 이긴다. "default"라고 약속하면 저장된
				// develop이 뜨는 순간 거짓말이 된다.
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
	// 알려지지 않은 실패도 서버가 준 말은 전한다 — 버리면 예전과 같은
	// "이유 없는 실패"다.
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

/**
 * 같은 카드인지 가르는 열쇠. watch 폴이 같은 실패를 2초마다 되풀이할 때
 * 카드를 다시 그리지 않으려고 쓴다(다시 그리면 버튼 포커스가 날아간다).
 */
export const loadErrorKey = (model: LoadErrorModel): string =>
	`${model.headline}\n${model.context}`;

export const renderLoadError = (
	doc: Document,
	model: LoadErrorModel,
	onAction: (kind: LoadErrorActionKind) => void,
): HTMLElement => {
	const root = doc.createElement("div");
	root.id = "empty";
	root.className = "empty-card";
	root.setAttribute("data-load-error", loadErrorKey(model));
	// 빈 상태 카드와 달리 이건 **일어난 일**의 통지다. 보조기술이 #status만
	// 읽고 지나가지 않게 한다.
	root.setAttribute("role", "alert");
	// id가 "empty"인 것도 계약이다 — 서버가 돌아와 304가 오면(빈 리포)
	// applyFetched가 enrichEmptyState로 복구하는데, 그 함수는 #empty를 찾아
	// 갈아 끼운다. id를 바꾸면 실패 카드가 복구 뒤에도 남는다.

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
