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
const input = () => popover.element.querySelector("input") as HTMLInputElement;
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

describe("옵션 B — 제출 버튼 + 상태 전용 슬롯", () => {
	test("평상시엔 힌트가 hidden이고 버튼은 ↵ 상태다", () => {
		const { popover: pop } = makePopover();
		pop.open({
			label: "a.ts:1-2 · new side",
			labelTitle: "src/a.ts",
			buildOutput: () => "out",
			placement: { left: 0, top: 0 },
		});
		const hint = pop.element.querySelector(".grab-hint") as HTMLElement;
		expect(hint.hidden).toBe(true);
		const btn = pop.element.querySelector("button.grab-submit");
		expect(btn?.getAttribute("aria-label")).toBe("Copy grab");
		expect(btn?.getAttribute("title")).toBe("Copy (Enter)");
	});

	test("제출 버튼 click만으로 복사되고 버튼이 ✓ 상태로 바뀐다", async () => {
		const { popover: pop, writes: capturedWrites } = makePopover();
		pop.open({
			label: "a.ts:1-2 · new side",
			labelTitle: "src/a.ts",
			buildOutput: (p) => `out:${p}`,
			placement: { left: 0, top: 0 },
		});
		const inputEl = pop.element.querySelector("input") as HTMLInputElement;
		inputEl.value = "hi";
		const btn = pop.element.querySelector(
			"button.grab-submit",
		) as HTMLButtonElement;
		btn.click();
		await Promise.resolve();
		await Promise.resolve();
		expect(capturedWrites).toEqual(["out:hi"]);
		expect(pop.element.textContent).toContain("Copied");
		expect(btn.getAttribute("aria-label")).toBe("Copied");
		const hint = pop.element.querySelector(".grab-hint") as HTMLElement;
		expect(hint.hidden).toBe(false);
	});

	test("복사 실패는 버튼 상태를 바꾸지 않고 힌트에만 표시한다", async () => {
		const { popover: pop } = makePopover({ fail: true });
		pop.open({
			label: "a.ts:1-2 · new side",
			labelTitle: "src/a.ts",
			buildOutput: () => "out",
			placement: { left: 0, top: 0 },
		});
		const btn = pop.element.querySelector(
			"button.grab-submit",
		) as HTMLButtonElement;
		btn.click();
		await Promise.resolve();
		await Promise.resolve();
		expect(pop.element.textContent).toContain("Copy failed");
		expect(btn.getAttribute("aria-label")).toBe("Copy grab");
	});

	// close()를 거치지 않는 재오픈 경로 — 이전 성공의 ✓가 남으면 실사용에서만 드러난다
	test("재오픈이 버튼 아이콘과 힌트를 초기화한다", async () => {
		const { popover: pop } = makePopover();
		const opts = {
			label: "a.ts:1-2 · new side",
			labelTitle: "src/a.ts",
			buildOutput: () => "out",
			placement: { left: 0, top: 0 },
		};
		pop.open(opts);
		(
			pop.element.querySelector("button.grab-submit") as HTMLButtonElement
		).click();
		await Promise.resolve();
		await Promise.resolve();
		pop.open(opts);
		const btn = pop.element.querySelector("button.grab-submit");
		expect(btn?.getAttribute("aria-label")).toBe("Copy grab");
		const hint = pop.element.querySelector(".grab-hint") as HTMLElement;
		expect(hint.hidden).toBe(true);
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
