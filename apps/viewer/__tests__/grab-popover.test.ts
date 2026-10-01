import "./happydom.ts";
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { GrabLabelPart } from "../browser/grab/encode.ts";
import {
	createGrabPopover,
	type GrabPopover,
} from "../browser/grab/popover.ts";

let writes: string[] = [];
let writeImpl: (text: string) => Promise<void> = (t) => {
	writes.push(t);
	return Promise.resolve();
};
let copied = 0;
let closed = 0;
let popover: GrabPopover;

// encode.ts의 grabLabelParts가 만드는 것과 같은 모양이다.
const labelParts = (name = "a.ts", range = ":1-2"): GrabLabelPart[] => [
	{ text: name, kind: "file" },
	{ text: range, kind: "range" },
	{ text: " · ", kind: "sep" },
	{ text: "new side", kind: "side" },
];

const openDefault = () =>
	popover.open({
		label: labelParts("main.ts", ":84-98"),
		labelTitle: "apps/viewer/browser/main.ts",
		buildOutput: (prompt) => `OUT[${prompt}]`,
		buildPlainOutput: () => "PLAIN",
		placement: { left: 10, top: 20 },
	});
const input = () =>
	popover.element.querySelector("textarea") as HTMLTextAreaElement;
const pressEnter = (init: KeyboardEventInit = {}) =>
	input().dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", cancelable: true, ...init }),
	);
// fake timers 중 setTimeout flush는 끝나지 않아 런 전체가 멈춘다 —
// 마이크로태스크 2틱으로 흘린다(copy-button.test.ts의 tick).
const flush = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
};

// 만든 인스턴스는 afterEach에서 destroy한다 — 안 그러면 doc 리스너가 happy-dom 전역에 쌓인다.
const createdPopovers: GrabPopover[] = [];
const makePopover = (
	options: { fail?: boolean } = {},
): { popover: GrabPopover; writes: string[] } => {
	const localWrites: string[] = [];
	const p = createGrabPopover({
		doc: document,
		writeText: (t) => {
			if (options.fail) return Promise.reject(new Error("denied"));
			localWrites.push(t);
			return Promise.resolve();
		},
	});
	document.body.append(p.element);
	createdPopovers.push(p);
	return { popover: p, writes: localWrites };
};

beforeEach(() => {
	document.body.innerHTML = "";
	writes = [];
	writeImpl = (t) => {
		writes.push(t);
		return Promise.resolve();
	};
	copied = 0;
	closed = 0;
	popover = createGrabPopover({
		doc: document,
		writeText: (t) => writeImpl(t),
		onCopied: () => copied++,
		onClosed: () => closed++,
	});
	document.body.append(popover.element);
	createdPopovers.length = 0;
});
afterEach(() => {
	popover.destroy();
	for (const p of createdPopovers) p.destroy();
	jest.useRealTimers();
});

describe("createGrabPopover", () => {
	test("open: 라벨·위치·포커스", () => {
		openDefault();
		expect(popover.isOpen()).toBe(true);
		expect(popover.element.textContent).toContain("main.ts:84-98 · new side");
		expect(popover.element.style.left).toBe("10px");
		expect(document.activeElement).toBe(input());
	});
	test("접근성: role=dialog + input aria-label", () => {
		expect(popover.element.getAttribute("role")).toBe("dialog");
		expect(input().getAttribute("aria-label")).toBe("Grab prompt");
	});
	test("Shift+Enter는 제출하지 않고 기본 개행을 막지도 않는다", async () => {
		openDefault();
		input().value = "첫 줄";
		const notCancelled = pressEnter({ shiftKey: true });
		await flush();
		expect(writes).toEqual([]);
		expect(copied).toBe(0);
		expect(popover.isOpen()).toBe(true);
		expect(notCancelled).toBe(true);
	});

	test("Shift 없는 Enter는 여전히 제출한다", async () => {
		openDefault();
		input().value = "제출";
		pressEnter();
		await flush();
		expect(writes).toEqual(["OUT[제출]"]);
	});

	// happy-dom은 기본 동작(개행)을 수행하지 않으므로 "취소했는가"로 단언한다.
	test("Shift 없는 Enter는 기본 개행을 막는다", () => {
		openDefault();
		input().value = "제출";
		const notCancelled = pressEnter();
		expect(notCancelled).toBe(false);
	});

	// IME 가드가 Shift 분기보다 먼저다(grab.md의 keydown 분기 순서).
	test("IME 조합 중에는 Shift+Enter도 제출하지 않는다", async () => {
		openDefault();
		input().value = "조합중";
		pressEnter({ shiftKey: true, isComposing: true });
		await flush();
		expect(writes).toEqual([]);
		expect(popover.isOpen()).toBe(true);
	});

	test("Enter → buildOutput(프롬프트) 복사 + Copied 상태 + onCopied + 자동 닫힘", async () => {
		jest.useFakeTimers();
		openDefault();
		input().value = "정리해줘";
		pressEnter();
		await flush();
		expect(writes).toEqual(["OUT[정리해줘]"]);
		expect(copied).toBe(1);
		expect(popover.element.textContent).toContain("Copied");
		jest.advanceTimersByTime(400);
		expect(popover.isOpen()).toBe(false);
		jest.useRealTimers();
	});
	test("Alt+Enter는 buildPlainOutput을 복사하고 기본 개행을 막는다", async () => {
		openDefault();
		input().value = "무시될 프롬프트";
		const notCancelled = pressEnter({ altKey: true });
		await flush();
		expect(notCancelled).toBe(false);
		expect(writes).toEqual(["PLAIN"]);
		expect(copied).toBe(1);
	});

	test("Alt+Enter도 Copied 상태 후 400ms 자동 닫힘", async () => {
		jest.useFakeTimers();
		openDefault();
		pressEnter({ altKey: true });
		await flush();
		expect(popover.element.textContent).toContain("Copied");
		jest.advanceTimersByTime(400);
		expect(popover.isOpen()).toBe(false);
		jest.useRealTimers();
	});

	test("IME 조합 중 Alt+Enter는 무시", () => {
		openDefault();
		pressEnter({ altKey: true, isComposing: true });
		expect(writes).toEqual([]);
		expect(popover.isOpen()).toBe(true);
	});

	test("IME 조합 중 Enter(isComposing)는 무시", () => {
		openDefault();
		input().value = "한글";
		pressEnter({ isComposing: true });
		expect(writes).toEqual([]);
		expect(popover.isOpen()).toBe(true);
	});
	test("keyCode 229 Enter도 무시", () => {
		openDefault();
		pressEnter({ keyCode: 229 } as KeyboardEventInit);
		expect(writes).toEqual([]);
	});
	test("빈 프롬프트 Enter 허용(컨텍스트만 복사)", async () => {
		openDefault();
		pressEnter();
		await flush();
		expect(writes).toEqual(["OUT[]"]);
	});
	test("쓰기 실패 → 에러 힌트 + 닫히지 않음 + onCopied 미호출", async () => {
		writeImpl = () => Promise.reject(new Error("denied"));
		openDefault();
		pressEnter();
		await flush();
		expect(popover.isOpen()).toBe(true);
		expect(popover.element.textContent).toContain("Copy failed");
		expect(copied).toBe(0);
	});
	test("Escape(input)와 외부 mousedown으로 닫힘, 내부 mousedown은 유지", () => {
		openDefault();
		input().dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
		);
		expect(popover.isOpen()).toBe(false);
		openDefault();
		input().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(popover.isOpen()).toBe(true);
		document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(popover.isOpen()).toBe(false);
	});
	test("IME 조합 중 Escape(input)는 무시 — 조합 취소가 팝오버를 닫지 않음", () => {
		openDefault();
		input().dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				cancelable: true,
				isComposing: true,
			}),
		);
		expect(popover.isOpen()).toBe(true);
	});
	test("doc 레벨 Escape로도 닫힘", () => {
		openDefault();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(popover.isOpen()).toBe(false);
	});
	test("IME 조합 중 doc 레벨 Escape는 무시", () => {
		openDefault();
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", isComposing: true }),
		);
		expect(popover.isOpen()).toBe(true);
	});
	test("destroy 후 doc 리스너 무반응", () => {
		openDefault();
		popover.destroy();
		document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(popover.isOpen()).toBe(true);
	});
	test("Esc(input)로 닫힐 때 onClosed 1회", () => {
		openDefault();
		input().dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
		);
		expect(closed).toBe(1);
	});
	test("doc 레벨 Escape로 닫힐 때도 onClosed 1회", () => {
		openDefault();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(closed).toBe(1);
	});
	test("외부 mousedown으로 닫힐 때 onClosed 1회", () => {
		openDefault();
		document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(closed).toBe(1);
	});
	test("복사 성공 후 자동 닫힘에서도 onClosed 1회 — onCopied와는 별개 타이밍", async () => {
		jest.useFakeTimers();
		openDefault();
		pressEnter();
		await flush();
		expect(copied).toBe(1);
		expect(closed).toBe(0);
		jest.advanceTimersByTime(400);
		expect(closed).toBe(1);
		jest.useRealTimers();
	});
	test("open→open(재오픈)에서는 onClosed 미호출", () => {
		openDefault();
		openDefault();
		expect(closed).toBe(0);
	});
	test("onClosed 미제공이어도 close()가 무해하다", () => {
		const p = createGrabPopover({
			doc: document,
			writeText: (t) => writeImpl(t),
		});
		document.body.append(p.element);
		p.open({
			label: labelParts("x", ""),
			labelTitle: "src/x.ts",
			buildOutput: () => "y",
			buildPlainOutput: () => "plain",
			placement: { left: 0, top: 0 },
		});
		expect(() => p.close()).not.toThrow();
		p.destroy();
	});
});

describe("상태 전용 슬롯 + 접근성", () => {
	// hidden 요소는 라이브 리전으로 읽히지 않으므로 "상태 없음"은 빈 텍스트다.
	test("평상시엔 라이브 리전이 비어 있고 버튼은 idle이다", () => {
		const { popover: pop } = makePopover();
		pop.open({
			label: labelParts(),
			labelTitle: "src/a.ts",
			buildOutput: () => "out",
			buildPlainOutput: () => "plain",
			placement: { left: 0, top: 0 },
		});
		const hint = pop.element.querySelector(".grab-hint") as HTMLElement;
		expect(hint.textContent).toBe("");
		const send = pop.element.querySelector(".grab-send") as HTMLElement;
		expect(send.dataset.state).toBe("idle");
	});

	// placeholder에 안내를 실으면 창에서 가장 눈에 띄는 요소가 된다.
	test("placeholder는 한 마디만 하고, 단축키는 각주·title·aria가 고지한다", () => {
		const { popover: pop } = makePopover();
		const box = pop.element.querySelector("textarea") as HTMLTextAreaElement;
		expect(box.placeholder).toBe("Prompt…");
		expect(box.getAttribute("aria-keyshortcuts")).toBe(
			"Enter Shift+Enter Alt+Enter Escape",
		);
		// 문구가 아니라 세 동작이 다 고지되는지만 본다.
		const send = pop.element.querySelector(".grab-send") as HTMLElement;
		expect(send.title).toContain("⏎");
		expect(send.title).toContain("new line");
		expect(send.title).toContain("plain code");
	});

	test("하단에 ⌥⏎ 단축키 각주가 렌더된다", () => {
		const { popover: pop } = makePopover();
		pop.open({
			label: labelParts(),
			labelTitle: "src/a.ts",
			buildOutput: () => "out",
			buildPlainOutput: () => "plain",
			placement: { left: 0, top: 0 },
		});
		const keys = pop.element.querySelector(".grab-keys") as HTMLElement;
		expect(keys.textContent).toBe("⌥⏎ Copy code only");
		const key = keys.querySelector(".grab-keys-k") as HTMLElement;
		expect(key.textContent).toBe("⌥⏎");
	});

	test("복사 실패는 힌트에 표시되고 팝오버는 열린 채 남는다", async () => {
		const { popover: pop } = makePopover({ fail: true });
		pop.open({
			label: labelParts(),
			labelTitle: "src/a.ts",
			buildOutput: () => "out",
			buildPlainOutput: () => "plain",
			placement: { left: 0, top: 0 },
		});
		const box = pop.element.querySelector("textarea") as HTMLTextAreaElement;
		box.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", cancelable: true }),
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(pop.element.textContent).toContain("Copy failed");
		expect(pop.isOpen()).toBe(true);
	});

	// close()를 거치지 않는 재오픈 경로다.
	test("재오픈이 힌트를 초기화한다", async () => {
		const { popover: pop } = makePopover();
		const opts = {
			label: labelParts(),
			labelTitle: "src/a.ts",
			buildOutput: () => "out",
			buildPlainOutput: () => "plain",
			placement: { left: 0, top: 0 },
		};
		pop.open(opts);
		const box = pop.element.querySelector("textarea") as HTMLTextAreaElement;
		box.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", cancelable: true }),
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(pop.element.textContent).toContain("Copied");
		const send = pop.element.querySelector(".grab-send") as HTMLElement;
		expect(send.dataset.state).toBe("ok");
		pop.open(opts);
		const hint = pop.element.querySelector(".grab-hint") as HTMLElement;
		expect(hint.textContent).toBe("");
		expect(send.dataset.state).toBe("idle");
	});

	test("라벨이 조각별 span으로 렌더된다 — 색을 줄 수 있는 유일한 형태", () => {
		const { popover: pop } = makePopover();
		pop.open({
			label: [
				{ text: "a.ts", kind: "file" },
				{ text: ":1-2", kind: "range" },
				{ text: " · ", kind: "sep" },
				{ text: "old side", kind: "side-old" },
			],
			labelTitle: "src/a.ts",
			buildOutput: () => "out",
			buildPlainOutput: () => "plain",
			placement: { left: 0, top: 0 },
		});
		const label = pop.element.querySelector(".grab-label") as HTMLElement;
		expect([...label.children].map((c) => c.className)).toEqual([
			"grab-l-file",
			"grab-l-range",
			"grab-l-sep",
			"grab-l-side-old",
		]);
		// 이어 붙이면 grabLabel()의 문자열과 같아야 한다(색과 텍스트가 갈라지지 않는다).
		expect(label.textContent).toBe("a.ts:1-2 · old side");
	});

	test("재오픈이 이전 라벨 조각을 지운다", () => {
		const { popover: pop } = makePopover();
		const base = {
			labelTitle: "src/a.ts",
			buildOutput: () => "out",
			buildPlainOutput: () => "plain",
			placement: { left: 0, top: 0 },
		};
		pop.open({ ...base, label: labelParts("a.ts", ":1-2") });
		pop.open({ ...base, label: labelParts("b.ts", ":9") });
		const label = pop.element.querySelector(".grab-label") as HTMLElement;
		expect(label.children.length).toBe(4);
		expect(label.textContent).toBe("b.ts:9 · new side");
	});

	test("라벨에 전체 경로 title이 붙는다", () => {
		const { popover: pop } = makePopover();
		pop.open({
			label: labelParts(),
			labelTitle: "src/deep/a.ts",
			buildOutput: () => "out",
			buildPlainOutput: () => "plain",
			placement: { left: 0, top: 0 },
		});
		const label = pop.element.querySelector(".grab-label");
		expect(label?.getAttribute("title")).toBe("src/deep/a.ts");
	});

	test("dialog에 이름이 붙고 인스턴스마다 id가 다르다", () => {
		const a = makePopover().popover;
		const b = makePopover().popover;
		const idA = a.element.getAttribute("aria-labelledby");
		const idB = b.element.getAttribute("aria-labelledby");
		expect(idA).toBeTruthy();
		expect(idB).toBeTruthy();
		expect(idA).not.toBe(idB);
		expect(a.element.querySelector(".grab-label")?.id).toBe(idA);
	});

	test("힌트가 스크린리더에 알려지는 라이브 리전이다", () => {
		const { popover: pop } = makePopover();
		const hint = pop.element.querySelector(".grab-hint");
		expect(hint?.getAttribute("role")).toBe("status");
		expect(hint?.getAttribute("aria-live")).toBe("polite");
	});
});

describe("보내기 버튼 — 입력 영역 안, 배경 없음", () => {
	const opts = {
		label: labelParts(),
		labelTitle: "src/a.ts",
		buildOutput: (p: string) => `out:${p}`,
		buildPlainOutput: () => "plain",
		placement: { left: 0, top: 0 },
	};

	test("입력 영역 안에 산다 — 팝오버 직속이 아니라 .grab-field의 자식", () => {
		const { popover: pop } = makePopover();
		const field = pop.element.querySelector(".grab-field");
		const send = pop.element.querySelector(".grab-send");
		expect(field).toBeTruthy();
		expect(send?.parentElement).toBe(field);
		expect(field?.querySelector("textarea")).toBeTruthy();
	});

	test("클릭이 Enter와 같은 출력을 복사한다", async () => {
		const { popover: pop, writes: local } = makePopover();
		pop.open(opts);
		const box = pop.element.querySelector("textarea") as HTMLTextAreaElement;
		box.value = "왜 바꿨어";
		const send = pop.element.querySelector(".grab-send") as HTMLButtonElement;
		send.click();
		await Promise.resolve();
		await Promise.resolve();
		expect(local).toEqual(["out:왜 바꿨어"]);
		expect(send.dataset.state).toBe("ok");
	});

	test("mousedown 기본동작을 막아 입력 포커스를 지킨다 — IME 조합 유실 방지", () => {
		const { popover: pop } = makePopover();
		pop.open(opts);
		const send = pop.element.querySelector(".grab-send") as HTMLButtonElement;
		const event = new MouseEvent("mousedown", { cancelable: true });
		send.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	});

	test("입력 유무로 강조만 바뀐다 — 비활성화하지 않는다", () => {
		const { popover: pop } = makePopover();
		pop.open(opts);
		const box = pop.element.querySelector("textarea") as HTMLTextAreaElement;
		const send = pop.element.querySelector(".grab-send") as HTMLButtonElement;
		expect(send.dataset.state).toBe("idle");
		box.value = "x";
		box.dispatchEvent(new Event("input"));
		expect(send.dataset.state).toBe("ready");
		box.value = "";
		box.dispatchEvent(new Event("input"));
		expect(send.dataset.state).toBe("idle");
		// 빈 프롬프트로도 참조+스니펫은 복사되므로 막으면 기능이 줄어든다.
		expect(send.disabled).toBe(false);
	});

	test("복사 실패는 버튼을 fail로 — 창은 열린 채", async () => {
		const { popover: pop } = makePopover({ fail: true });
		pop.open(opts);
		const send = pop.element.querySelector(".grab-send") as HTMLButtonElement;
		send.click();
		await Promise.resolve();
		await Promise.resolve();
		expect(send.dataset.state).toBe("fail");
		expect(pop.isOpen()).toBe(true);
	});

	test("아이콘 셋이 전부 DOM에 있고 이름은 상태와 무관하게 고정이다", () => {
		const { popover: pop } = makePopover();
		const send = pop.element.querySelector(".grab-send") as HTMLButtonElement;
		// 상태마다 innerHTML을 갈면 매번 파서를 태운다 — 셋을 두고 CSS가 하나만 보인다.
		expect(send.querySelector(".i-send")).toBeTruthy();
		expect(send.querySelector(".i-ok")).toBeTruthy();
		expect(send.querySelector(".i-fail")).toBeTruthy();
		// 상태는 라이브 리전이 알린다. 이름까지 바뀌면 두 번 말한다.
		expect(send.getAttribute("aria-label")).toBe("Copy to clipboard");
		expect(send.type).toBe("button");
	});
});

describe("닫기 버튼 — 라벨 줄 오른쪽 끝", () => {
	const closeBtn = (pop: GrabPopover) =>
		pop.element.querySelector(".grab-close") as HTMLButtonElement;

	test("라벨과 같은 줄(.grab-head)에 산다 — 팝오버 높이를 늘리지 않는 자리", () => {
		const { popover: pop } = makePopover();
		const head = pop.element.querySelector(".grab-head");
		expect(head?.parentElement).toBe(pop.element);
		expect([...(head?.children ?? [])].map((c) => c.className)).toEqual([
			"grab-label",
			"grab-close",
		]);
	});

	test("아이콘 전용 버튼이라 이름과 단축키 툴팁을 갖는다", () => {
		const { popover: pop } = makePopover();
		const btn = closeBtn(pop);
		expect(btn.type).toBe("button");
		// 툴팁은 #find-close와 같지만 이름은 대상을 말하지 않는 "Close"다(그쪽은 "Close search").
		expect(btn.getAttribute("aria-label")).toBe("Close");
		expect(btn.title).toBe("Close (Esc)");
		// 텍스트가 없어야 다이얼로그·라벨의 textContent에 섞이지 않는다.
		expect(btn.textContent).toBe("");
		expect(btn.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
	});

	test("클릭하면 닫히고 onClosed가 1회 — 다른 닫힘 경로와 같은 close()", () => {
		openDefault();
		closeBtn(popover).click();
		expect(popover.isOpen()).toBe(false);
		expect(popover.element.hidden).toBe(true);
		expect(closed).toBe(1);
		expect(writes).toEqual([]);
	});

	test("mousedown 기본동작을 막는다 — 보내기 버튼과 같은 포커스 계약", () => {
		openDefault();
		const event = new MouseEvent("mousedown", { cancelable: true });
		closeBtn(popover).dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	});

	test("자동 닫힘 대기 중에 눌러도 타이머가 두 번째 close를 부르지 않는다", async () => {
		jest.useFakeTimers();
		openDefault();
		pressEnter();
		await flush();
		closeBtn(popover).click();
		expect(closed).toBe(1);
		jest.advanceTimersByTime(400);
		expect(closed).toBe(1);
	});
});
