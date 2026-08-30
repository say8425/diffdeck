import "./happydom";
import { describe, expect, test } from "bun:test";
import {
	buildEmptyStateModel,
	renderEmptyState,
	shouldAutoViewBase,
} from "../browser/emptyState.ts";
import type { EmptyStateModel } from "../browser/emptyState.ts";
import type { RepoSummary } from "../server/summary.ts";

const summary = (over: Partial<RepoSummary> = {}): RepoSummary => ({
	branch: "feature",
	head: "abc1234",
	base: "main",
	workingFiles: 0,
	baseFiles: 0,
	untrackedFiles: 0,
	aheadCommits: 0,
	...over,
});

describe("buildEmptyStateModel", () => {
	test("working mode: committed branch work becomes a switch action", () => {
		const m = buildEmptyStateModel(
			summary({ baseFiles: 12, aheadCommits: 3 }),
			{
				mode: "working",
				untrackedShown: false,
			},
		);
		expect(m.headline).toBe("Working tree clean");
		expect(m.context).toBe("on feature · 3 commit(s) ahead of main");
		expect(m.actions).toEqual([
			{ kind: "switch-mode", label: "12 file(s) changed vs main — view" },
		]);
		expect(m.quietNote).toBeNull();
	});

	test("hidden untracked files become a show action (both modes)", () => {
		for (const mode of ["working", "base"] as const) {
			const m = buildEmptyStateModel(summary({ untrackedFiles: 3 }), {
				mode,
				untrackedShown: false,
			});
			expect(m.actions).toEqual([
				{ kind: "show-untracked", label: "3 untracked file(s) hidden — show" },
			]);
		}
	});

	test("untracked already shown: no show action", () => {
		const m = buildEmptyStateModel(summary({ untrackedFiles: 3 }), {
			mode: "working",
			untrackedShown: true,
		});
		expect(m.actions).toEqual([]);
	});

	test("base mode headline names the base", () => {
		const m = buildEmptyStateModel(summary(), {
			mode: "base",
			untrackedShown: false,
		});
		expect(m.headline).toBe("No changes vs main");
	});

	test("base mode without a resolved base", () => {
		const m = buildEmptyStateModel(
			summary({ base: null, baseFiles: null, aheadCommits: null }),
			{ mode: "base", untrackedShown: false },
		);
		expect(m.headline).toBe("No changes");
		expect(m.context).toBe("on feature");
		expect(m.quietNote).toBe("Nothing to show in any mode");
	});

	test("all measured zeros yield the quiet note", () => {
		const m = buildEmptyStateModel(summary({ branch: "main" }), {
			mode: "working",
			untrackedShown: false,
		});
		expect(m.quietNote).toBe("Nothing to show in any mode");
	});

	test("unknown base counts suppress the quiet note", () => {
		// merge-base 실패(orphan 브랜치 등): base 이름은 있지만 측정은 실패한
		// 모양 — 측정 못 한 것을 '아무것도 없음'이라고 주장하면 안 된다.
		const m = buildEmptyStateModel(
			summary({ branch: "lonely", baseFiles: null, aheadCommits: null }),
			{ mode: "working", untrackedShown: false },
		);
		expect(m.quietNote).toBeNull();
	});

	test("hidden untracked files change the working-mode headline", () => {
		// git 어휘상 untracked도 워킹트리 상태 — 숨겨진 untracked가 있는데
		// "Working tree clean"이라고 말하면 자기모순이다.
		const m = buildEmptyStateModel(summary({ untrackedFiles: 3 }), {
			mode: "working",
			untrackedShown: false,
		});
		expect(m.headline).toBe("No tracked changes");
	});

	test("base mode with nonzero baseFiles offers no switch action", () => {
		const m = buildEmptyStateModel(summary({ baseFiles: 5 }), {
			mode: "base",
			untrackedShown: false,
		});
		expect(m.actions).toEqual([]);
	});

	test("ahead commits with an empty base diff: context only, not quiet", () => {
		const m = buildEmptyStateModel(summary({ aheadCommits: 2 }), {
			mode: "working",
			untrackedShown: false,
		});
		expect(m.context).toBe("on feature · 2 commit(s) ahead of main");
		expect(m.actions).toEqual([]);
		expect(m.quietNote).toBeNull();
	});

	test("detached HEAD context uses the short sha", () => {
		const m = buildEmptyStateModel(summary({ branch: null }), {
			mode: "working",
			untrackedShown: false,
		});
		expect(m.context).toBe("detached @ abc1234");
	});

	test("working mode ignores a zero baseFiles for actions", () => {
		const m = buildEmptyStateModel(summary({ baseFiles: 0 }), {
			mode: "working",
			untrackedShown: false,
		});
		expect(m.actions).toEqual([]);
	});
});

describe("renderEmptyState", () => {
	test("renders headline/context and wires action clicks", () => {
		const clicks: string[] = [];
		const el = renderEmptyState(
			document,
			{
				headline: "Working tree clean",
				context: "on feature · 3 commit(s) ahead of main",
				actions: [
					{ kind: "switch-mode", label: "12 file(s) changed vs main — view" },
					{
						kind: "show-untracked",
						label: "3 untracked file(s) hidden — show",
					},
				],
				quietNote: null,
			},
			{
				onSwitchMode: () => clicks.push("switch"),
				onShowUntracked: () => clicks.push("untracked"),
			},
		);
		expect(el.id).toBe("empty");
		expect(el.querySelector(".empty-headline")?.textContent).toBe(
			"Working tree clean",
		);
		expect(el.querySelector(".empty-context")?.textContent).toBe(
			"on feature · 3 commit(s) ahead of main",
		);
		const buttons = Array.from(
			el.querySelectorAll<HTMLButtonElement>("button.empty-action"),
		);
		expect(buttons.map((b) => b.textContent)).toEqual([
			"12 file(s) changed vs main — view",
			"3 untracked file(s) hidden — show",
		]);
		for (const b of buttons) b.click();
		expect(clicks).toEqual(["switch", "untracked"]);
	});

	test("renders the quiet note and omits an empty context", () => {
		const el = renderEmptyState(
			document,
			{
				headline: "Working tree clean",
				context: "",
				actions: [],
				quietNote: "Nothing to show in any mode",
			},
			{ onSwitchMode: () => {}, onShowUntracked: () => {} },
		);
		expect(el.querySelector(".empty-quiet")?.textContent).toBe(
			"Nothing to show in any mode",
		);
		expect(el.querySelector(".empty-context")).toBeNull();
		expect(el.querySelectorAll("button.empty-action").length).toBe(0);
	});
});

describe("shouldAutoViewBase", () => {
	// 워크트리 워크플로에서는 작업이 브랜치에 **커밋**돼 있어서 기본 뷰
	// (미커밋 변경)가 구조적으로 비어 있다. 정작 볼 게 가장 많을 때 빈 화면이
	// 뜨는 셈이라, 고른 적이 없다면 볼 것이 있는 쪽을 연다.
	const model = (over: Partial<EmptyStateModel> = {}): EmptyStateModel => ({
		headline: "Working tree clean",
		context: "on feature · 3 commit(s) ahead of main",
		actions: [
			{ kind: "switch-mode", label: "12 file(s) changed vs main — view" },
		],
		quietNote: null,
		...over,
	});

	test("고른 적 없고 base에 볼 것이 있으면 전환한다", () => {
		expect(
			shouldAutoViewBase(model(), {
				hasExplicitBase: false,
				alreadyTried: false,
			}),
		).toBe(true);
	});

	// 명시적 선택은 절대 덮지 않는다 — URL의 base=든 저장된 프리퍼런스든.
	test("사용자가 고른 적 있으면 전환하지 않는다", () => {
		expect(
			shouldAutoViewBase(model(), {
				hasExplicitBase: true,
				alreadyTried: false,
			}),
		).toBe(false);
	});

	// 무한 루프 방지. 조건이 계속 참이어도 한 번만 시도한다.
	test("이미 시도했으면 다시 전환하지 않는다", () => {
		expect(
			shouldAutoViewBase(model(), {
				hasExplicitBase: false,
				alreadyTried: true,
			}),
		).toBe(false);
	});

	test("base에 볼 것이 없으면 전환하지 않는다", () => {
		expect(
			shouldAutoViewBase(model({ actions: [] }), {
				hasExplicitBase: false,
				alreadyTried: false,
			}),
		).toBe(false);
	});

	// **경계선**: 토글로 감춰졌을 뿐 이 뷰에도 볼 것이 있으면 데려가지 않는다.
	// 사용자가 untracked를 보고 싶었을 수도 있고, 카드가 두 선택지를 나란히
	// 보여주는 편이 낫다. 자동 전환은 "이 뷰에 아무것도 없을 때"로 한정한다.
	test("숨겨진 untracked가 있으면 전환하지 않는다", () => {
		expect(
			shouldAutoViewBase(
				model({
					actions: [
						{ kind: "switch-mode", label: "12 file(s) changed vs main — view" },
						{
							kind: "show-untracked",
							label: "1 untracked file(s) hidden — show",
						},
					],
				}),
				{ hasExplicitBase: false, alreadyTried: false },
			),
		).toBe(false);
	});
});
