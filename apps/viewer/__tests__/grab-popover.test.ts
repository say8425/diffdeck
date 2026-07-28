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
let popover: GrabPopover;

const openDefault = () =>
	popover.open({
		label: "main.ts:84-98 · new side",
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

beforeEach(() => {
	document.body.innerHTML = "";
	writes = [];
	writeImpl = (t) => {
		writes.push(t);
		return Promise.resolve();
	};
	copied = 0;
	popover = createGrabPopover({
		doc: document,
		writeText: (t) => writeImpl(t),
		onCopied: () => copied++,
	});
	document.body.append(popover.element);
});
afterEach(() => {
	popover.destroy();
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
	test("doc 레벨 Escape로도 닫힘", () => {
		openDefault();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(popover.isOpen()).toBe(false);
	});
	test("destroy 후 doc 리스너 무반응", () => {
		openDefault();
		popover.destroy();
		document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(popover.isOpen()).toBe(true);
	});
});
