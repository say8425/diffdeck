// 그랩 트리거를 눌렀을 때 뜨는 프롬프트 입력 팝오버. 요소는 항상 DOM에
// 붙어있고(hidden 토글) main이 body에 append한다 — trigger.ts/findBar.ts와
// 동일하게 리스너는 생성 시 등록, destroy()에서 해제(happy-dom 전역 window
// 누적 방지).
import type { Placement } from "./position.ts";

export interface GrabPopoverDeps {
	doc: Document;
	writeText(text: string): Promise<void>; // main: navigator.clipboard 래퍼; 테스트: fake
	onCopied?(): void; // main: codeView.clearSelectedLines()
}

export interface GrabOpenOptions {
	label: string;
	buildOutput(prompt: string): string;
	placement: Placement;
}

export interface GrabPopover {
	element: HTMLElement; // #grab-popover — main이 body에 append
	open(options: GrabOpenOptions): void;
	close(): void;
	isOpen(): boolean;
	destroy(): void;
}

const HINT_DEFAULT = "Enter ↵ · Esc";
const HINT_COPIED = "Copied ✓";
const HINT_FAILED = "Copy failed";
const AUTO_CLOSE_MS = 1200;

export const createGrabPopover = (deps: GrabPopoverDeps): GrabPopover => {
	const { doc } = deps;

	const element = doc.createElement("div");
	element.id = "grab-popover";
	element.hidden = true;
	element.setAttribute("role", "dialog");

	const label = doc.createElement("div");
	label.className = "grab-label";

	const input = doc.createElement("input");
	input.type = "text";
	input.className = "grab-input";
	input.placeholder = "Prompt… (Enter to copy)";
	input.setAttribute("aria-label", "Grab prompt");

	const hint = doc.createElement("span");
	hint.className = "grab-hint";
	hint.textContent = HINT_DEFAULT;

	element.append(label, input, hint);

	let opened = false;
	let buildOutput: ((prompt: string) => string) | null = null;
	let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

	const clearAutoCloseTimer = (): void => {
		if (autoCloseTimer !== null) {
			clearTimeout(autoCloseTimer);
			autoCloseTimer = null;
		}
	};

	const close = (): void => {
		opened = false;
		element.hidden = true;
		input.blur();
		clearAutoCloseTimer();
	};

	const open = (options: GrabOpenOptions): void => {
		label.textContent = options.label;
		// options.buildOutput을 그대로 tear-off하지 않고 래핑 호출한다
		// (oxlint unbound-method — 인터페이스 메서드 시그니처의 this 바인딩 경고).
		buildOutput = (prompt) => options.buildOutput(prompt);
		element.style.left = `${options.placement.left}px`;
		element.style.top = `${options.placement.top}px`;
		input.value = "";
		hint.textContent = HINT_DEFAULT;
		clearAutoCloseTimer();
		opened = true;
		element.hidden = false;
		input.focus();
	};

	const onCopySuccess = (): void => {
		hint.textContent = HINT_COPIED;
		deps.onCopied?.();
		clearAutoCloseTimer();
		autoCloseTimer = setTimeout(() => {
			autoCloseTimer = null;
			close();
		}, AUTO_CLOSE_MS);
	};

	const onCopyFailure = (err: unknown): void => {
		hint.textContent = HINT_FAILED;
		console.warn(err);
	};

	const submit = (): void => {
		const output = buildOutput?.(input.value) ?? "";
		deps.writeText(output).then(onCopySuccess, onCopyFailure);
	};

	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			if (event.isComposing || event.keyCode === 229) return;
			submit();
		} else if (event.key === "Escape") {
			if (event.isComposing || event.keyCode === 229) return;
			close();
		}
	});

	const onDocDismiss = (event: Event): void => {
		if (!opened) return;
		if (element.contains(event.target as Node)) return;
		close();
	};
	const onDocKeydown = (event: KeyboardEvent): void => {
		if (!opened || event.key !== "Escape") return;
		if (event.isComposing || event.keyCode === 229) return;
		close();
	};
	doc.addEventListener("pointerdown", onDocDismiss);
	doc.addEventListener("mousedown", onDocDismiss);
	doc.addEventListener("keydown", onDocKeydown);

	return {
		element,
		open,
		close,
		isOpen: () => opened,
		destroy: () => {
			clearAutoCloseTimer();
			doc.removeEventListener("pointerdown", onDocDismiss);
			doc.removeEventListener("mousedown", onDocDismiss);
			doc.removeEventListener("keydown", onDocKeydown);
		},
	};
};
