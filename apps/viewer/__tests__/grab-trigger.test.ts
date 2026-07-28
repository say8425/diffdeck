import "./happydom.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import {
	createGrabTrigger,
	type GrabTriggerDeps,
} from "../browser/grab/trigger.ts";

let hasSel = true;
let activated = 0;
const make = (over: Partial<GrabTriggerDeps> = {}) => {
	const scrollHost = document.createElement("div");
	document.body.append(scrollHost);
	const trigger = createGrabTrigger({
		doc: document,
		scrollHost,
		hasSelection: () => hasSel,
		onActivate: () => activated++,
		...over,
	});
	document.body.append(trigger.element);
	return { trigger, scrollHost };
};

beforeEach(() => {
	document.body.innerHTML = "";
	hasSel = true;
	activated = 0;
});

describe("createGrabTrigger", () => {
	test("show가 fixed 좌표를 적용하고 보이게 한다", () => {
		const { trigger } = make();
		trigger.show({ left: 40, top: 90 });
		expect(trigger.isVisible()).toBe(true);
		expect(trigger.element.style.left).toBe("40px");
		expect(trigger.element.style.top).toBe("90px");
		trigger.destroy();
	});
	test("pointerdown은 preventDefault(선택 보존)", () => {
		const { trigger } = make();
		const ev = new MouseEvent("mousedown", { cancelable: true });
		trigger.element.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(true);
		trigger.destroy();
	});
	test("클릭 → onActivate", () => {
		const { trigger } = make();
		trigger.show({ left: 0, top: 0 });
		trigger.element.dispatchEvent(new MouseEvent("click"));
		expect(activated).toBe(1);
		trigger.destroy();
	});
	test("selectionchange에서 선택이 사라지면 hide, 살아있으면 유지", () => {
		const { trigger } = make();
		trigger.show({ left: 0, top: 0 });
		document.dispatchEvent(new Event("selectionchange"));
		expect(trigger.isVisible()).toBe(true);
		hasSel = false;
		document.dispatchEvent(new Event("selectionchange"));
		expect(trigger.isVisible()).toBe(false);
		trigger.destroy();
	});
	test("scrollHost 스크롤/Escape로 hide", () => {
		const { trigger, scrollHost } = make();
		trigger.show({ left: 0, top: 0 });
		scrollHost.dispatchEvent(new Event("scroll"));
		expect(trigger.isVisible()).toBe(false);
		trigger.show({ left: 0, top: 0 });
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(trigger.isVisible()).toBe(false);
		trigger.destroy();
	});
	test("destroy 후 doc 이벤트는 무반응", () => {
		const { trigger } = make();
		trigger.show({ left: 0, top: 0 });
		trigger.destroy();
		hasSel = false;
		document.dispatchEvent(new Event("selectionchange"));
		expect(trigger.isVisible()).toBe(true); // 리스너 해제됨 — 상태 불변
	});
});
