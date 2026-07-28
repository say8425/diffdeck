// 텍스트 선택 시 뜨는 플로팅 트리거 버튼의 상태기계. 버튼 자체는 항상 DOM에
// 붙어있고(hidden 토글) main이 body에 append한다 — findBar.ts와 동일하게
// 리스너는 생성 시 등록, destroy()에서 해제(happy-dom 전역 window 누적 방지).
import type { Placement } from "./position.ts";

export interface GrabTriggerDeps {
	doc: Document;
	scrollHost: HTMLElement;
	hasSelection(): boolean; // main: document.getSelection() non-collapsed 여부
	onActivate(): void; // main: 팝오버 오픈(armed 스냅샷 재사용)
}

export interface GrabTrigger {
	element: HTMLButtonElement; // #grab-trigger — main이 body에 append
	show(placement: Placement): void;
	hide(): void;
	isVisible(): boolean;
	destroy(): void;
}

// 네이티브 mousedown/pointerdown 기본 동작은 선택을 붕괴시키고 포커스를
// 버튼으로 옮긴다 — Cmd+C로 이어지는 사용자의 네이티브 선택을 보존하려면
// 둘 다 막아야 한다(실 Chrome은 두 이벤트 모두 발화; happy-dom은
// PointerEvent가 없어 mousedown만 테스트되지만 구현은 둘 다 등록).
const onPreventDefault = (event: Event): void => {
	event.preventDefault();
};

export const createGrabTrigger = (deps: GrabTriggerDeps): GrabTrigger => {
	const { doc, scrollHost } = deps;

	const element = doc.createElement("button");
	element.type = "button";
	element.id = "grab-trigger";
	element.textContent = "Prompt";
	element.hidden = true;

	let visible = false;

	const hide = (): void => {
		visible = false;
		element.hidden = true;
	};

	const show = (placement: Placement): void => {
		element.style.left = `${placement.left}px`;
		element.style.top = `${placement.top}px`;
		visible = true;
		element.hidden = false;
	};

	element.addEventListener("mousedown", onPreventDefault);
	element.addEventListener("pointerdown", onPreventDefault);
	element.addEventListener("click", () => {
		deps.onActivate();
	});

	const onSelectionChange = (): void => {
		if (!deps.hasSelection()) hide();
	};
	const onScroll = (): void => {
		hide();
	};
	const onKeydown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") hide();
	};
	doc.addEventListener("selectionchange", onSelectionChange);
	scrollHost.addEventListener("scroll", onScroll);
	doc.addEventListener("keydown", onKeydown);

	return {
		element,
		show,
		hide,
		isVisible: () => visible,
		destroy: () => {
			doc.removeEventListener("selectionchange", onSelectionChange);
			scrollHost.removeEventListener("scroll", onScroll);
			doc.removeEventListener("keydown", onKeydown);
		},
	};
};
