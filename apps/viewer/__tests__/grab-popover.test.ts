import "./happydom.ts";
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
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

const openDefault = () =>
	popover.open({
		label: "main.ts:84-98 · new side",
		labelTitle: "apps/viewer/browser/main.ts",
		buildOutput: (prompt) => `OUT[${prompt}]`,
		placement: { left: 10, top: 20 },
	});
const input = () =>
	popover.element.querySelector("textarea") as HTMLTextAreaElement;
const pressEnter = (init: KeyboardEventInit = {}) =>
	input().dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", cancelable: true, ...init }),
	);
// jest.useFakeTimers() 아래에서는 setTimeout 기반 flush가 영원히 resolve되지
// 않는다(bun의 자체 per-test 타임아웃도 같은 타이머를 타서 런 전체가
// 데드락) — copy-button.test.ts의 tick()과 동일하게 마이크로태스크 2틱으로
// flush한다(writeText 프라미스 settle 1틱 + .then 콜백 1틱).
const flush = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
};

// 새 팝오버 인스턴스가 필요한 테스트 전용 헬퍼(재오픈 계약·다중 인스턴스 id
// 비교 등은 module-level 공유 popover로는 표현 못 한다) — 기존
// beforeEach/writeImpl 관례(:102 부근 reject로 실패 만들기)를 그대로 재사용해
// fresh 인스턴스+독립 writes를 돌려준다. createdPopovers에 쌓아 afterEach에서
// 함께 destroy한다(doc 리스너 누적 방지, happy-dom 전역 오염 회피).
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
	// 여러 줄 프롬프트: Shift+Enter는 개행이라 제출되면 안 된다. preventDefault를
	// 부르지 않고 빠져나가 textarea 기본 동작에 맡기므로, 여기선 "제출이 일어나지
	// 않았다"와 "이벤트를 취소하지 않았다"를 함께 본다(취소하면 개행이 죽는다).
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

	// textarea에서 Enter의 기본 동작은 개행이다 — 제출 경로는 그것을 막아야
	// 한다. 안 막으면 제출과 동시에 빈 줄이 남는다(실사용에서 보고된 버그).
	// happy-dom은 기본 동작을 수행하지 않으므로 "취소했는가"로 단언한다.
	test("Shift 없는 Enter는 기본 개행을 막는다", () => {
		openDefault();
		input().value = "제출";
		const notCancelled = pressEnter();
		expect(notCancelled).toBe(false);
	});

	// IME 조합 가드가 Shift 여부보다 먼저다 — 한국어 조합 확정 Enter가
	// Shift와 함께 눌려도 제출도 개행 처리도 우리 코드가 관여하지 않는다.
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
		jest.advanceTimersByTime(1200);
		expect(popover.isOpen()).toBe(false);
		jest.useRealTimers();
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
		// 복사 성공 직후엔 아직 열려 있다 — onCopied만 발화하고 onClosed는 아직.
		expect(copied).toBe(1);
		expect(closed).toBe(0);
		jest.advanceTimersByTime(1200);
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
			label: "x",
			labelTitle: "src/x.ts",
			buildOutput: () => "y",
			placement: { left: 0, top: 0 },
		});
		expect(() => p.close()).not.toThrow();
		p.destroy();
	});
});

describe("상태 전용 슬롯 + 접근성", () => {
	// 라이브 리전은 이제 sr-only라 항상 DOM에 붙어 있다(hidden 요소는 스크린리더에
	// 알려지지 않는다). "상태 없음"은 hidden이 아니라 **빈 텍스트**로 표현된다.
	test("평상시엔 라이브 리전이 비어 있고 버튼은 idle이다", () => {
		const { popover: pop } = makePopover();
		pop.open({
			label: "a.ts:1-2 · new side",
			labelTitle: "src/a.ts",
			buildOutput: () => "out",
			placement: { left: 0, top: 0 },
		});
		const hint = pop.element.querySelector(".grab-hint") as HTMLElement;
		expect(hint.textContent).toBe("");
		const send = pop.element.querySelector(".grab-send") as HTMLElement;
		expect(send.dataset.state).toBe("idle");
	});

	// 제출 버튼이 없으므로 단축키 고지는 입력창의 placeholder와 aria가 전담한다.
	test("입력창이 단축키를 placeholder와 aria로 고지한다", () => {
		const { popover: pop } = makePopover();
		const box = pop.element.querySelector("textarea") as HTMLTextAreaElement;
		// 표기(글자/글리프)가 아니라 **두 동작이 다 고지되는가**를 본다 —
		// 문구를 다듬어도 안내가 통째로 빠지는 회귀만 잡히면 된다.
		expect(box.placeholder).toContain("copy");
		expect(box.placeholder).toContain("new line");
		expect(box.getAttribute("aria-keyshortcuts")).toBe(
			"Enter Shift+Enter Escape",
		);
	});

	test("복사 실패는 힌트에 표시되고 팝오버는 열린 채 남는다", async () => {
		const { popover: pop } = makePopover({ fail: true });
		pop.open({
			label: "a.ts:1-2 · new side",
			labelTitle: "src/a.ts",
			buildOutput: () => "out",
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

	// close()를 거치지 않는 재오픈 경로 — 이전 상태가 남으면 실사용에서만 드러난다
	test("재오픈이 힌트를 초기화한다", async () => {
		const { popover: pop } = makePopover();
		const opts = {
			label: "a.ts:1-2 · new side",
			labelTitle: "src/a.ts",
			buildOutput: () => "out",
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

	test("라벨에 전체 경로 title이 붙는다", () => {
		const { popover: pop } = makePopover();
		pop.open({
			label: "a.ts:1-2 · new side",
			labelTitle: "src/deep/a.ts",
			buildOutput: () => "out",
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
		label: "a.ts:1-2 · new side",
		labelTitle: "src/a.ts",
		buildOutput: (p: string) => `out:${p}`,
		placement: { left: 0, top: 0 },
	};

	test("입력 영역 안에 산다 — 팝오버 직속이 아니라 .grab-field의 자식", () => {
		const { popover: pop } = makePopover();
		const field = pop.element.querySelector(".grab-field");
		const send = pop.element.querySelector(".grab-send");
		expect(field).toBeTruthy();
		// textarea와 버튼이 같은 상자를 공유하는 게 이 디자인의 전부다.
		expect(send?.parentElement).toBe(field);
		expect(field?.querySelector("textarea")).toBeTruthy();
	});

	test("클릭이 Enter와 같은 출력을 복사한다", async () => {
		const { popover: pop, writes } = makePopover();
		pop.open(opts);
		const box = pop.element.querySelector("textarea") as HTMLTextAreaElement;
		box.value = "왜 바꿨어";
		const send = pop.element.querySelector(".grab-send") as HTMLButtonElement;
		send.click();
		await Promise.resolve();
		await Promise.resolve();
		expect(writes).toEqual(["out:왜 바꿨어"]);
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
		// 셋을 다 두고 CSS가 하나만 보여준다 — 상태마다 innerHTML을 갈면
		// 매번 파서를 태우고 재측정을 유발한다.
		expect(send.querySelector(".i-send")).toBeTruthy();
		expect(send.querySelector(".i-ok")).toBeTruthy();
		expect(send.querySelector(".i-fail")).toBeTruthy();
		// 상태는 라이브 리전이 알린다. 이름까지 바뀌면 두 번 말한다.
		expect(send.getAttribute("aria-label")).toBe("Copy to clipboard");
		expect(send.type).toBe("button");
	});
});
