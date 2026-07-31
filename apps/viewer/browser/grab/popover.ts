// diff-grab 프롬프트 입력 팝오버 — 거터 "+" 클릭 또는 텍스트 드래그 릴리스
// 시 뜬다. 요소는 항상 DOM에 붙어있고(hidden 토글) main이 body에 append한다 —
// findBar.ts와 동일하게 리스너는 생성 시 등록, destroy()에서 해제(happy-dom
// 전역 window 누적 방지).
import type { Placement } from "./position.ts";

export interface GrabPopoverDeps {
	doc: Document;
	writeText(text: string): Promise<void>; // main: navigator.clipboard 래퍼; 테스트: fake
	onCopied?(): void; // main: codeView.clearSelectedLines() — 복사 성공 즉시
	onClosed?(): void; // main: codeView.clearSelectedLines() — close() 경로 전부
	// (Esc·외부 dismiss·복사 성공 후 자동 닫힘) 공통. onCopied와 이중 호출돼도
	// clearSelectedLines()는 멱등이라 무해하다.
}

export interface GrabOpenOptions {
	label: string;
	labelTitle: string; // 전체 경로 — 라벨은 basename만 보여주고 ellipsis로 잘린다
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

const HINT_COPIED = "Copied";
const HINT_COPIED_MARK = "✓";
const HINT_FAILED = "Copy failed";
const AUTO_CLOSE_MS = 1200;

// 같은 document에 여러 인스턴스가 생길 수 있다(테스트가 실제로 그렇게 한다) —
// aria-labelledby id가 충돌하면 스크린리더가 엉뚱한 라벨을 읽는다.
let popoverSeq = 0;

export const createGrabPopover = (deps: GrabPopoverDeps): GrabPopover => {
	const { doc } = deps;

	const element = doc.createElement("div");
	element.id = "grab-popover";
	element.hidden = true;
	element.setAttribute("role", "dialog");

	const label = doc.createElement("div");
	label.className = "grab-label";
	label.id = `grab-popover-label-${(popoverSeq += 1)}`;
	element.setAttribute("aria-labelledby", label.id);

	// <input>이 아니라 <textarea>인 이유: 에이전트 프롬프트는 여러 줄이 자연스럽다.
	// Shift+Enter로 개행하고 Enter로 제출한다. 높이는 CSS field-sizing이 내용에
	// 맞춰 늘리므로(최대 높이 후 스크롤) 여기에 JS 측정 로직을 두지 않는다.
	const input = doc.createElement("textarea");
	input.rows = 1;
	input.className = "grab-input";
	// 상시 힌트 줄도 제출 버튼도 없으므로 단축키 고지는 placeholder가 전담한다.
	// 힌트 줄이 어색했던 원인은 "안내가 있다"가 아니라 placeholder와 **같은 말을
	// 두 번** 한 것이었다 — 채널이 하나면 중복이 없다. 입력을 시작하면 사라지므로
	// 상주 노이즈도 아니다(발견용 안내).
	input.placeholder = "Prompt… (⏎ copy · shift + ⏎ new line)";
	input.setAttribute("aria-label", "Grab prompt");
	input.setAttribute("aria-keyshortcuts", "Enter Shift+Enter Escape");

	// 상태 전용 라이브 리전. 상시 어포던스(버튼)와 임시 상태를 다른 채널에 둔다 —
	// 한 노드가 겸용하면 실패로 전이할 때 조작 안내가 사라진다.
	const hint = doc.createElement("span");
	hint.className = "grab-hint";
	hint.hidden = true;
	hint.setAttribute("role", "status");
	hint.setAttribute("aria-live", "polite");
	const hintMark = doc.createElement("span");
	hintMark.className = "grab-check";
	const hintText = doc.createTextNode("");
	hint.append(hintMark, hintText);

	// textContent가 "✓ Copied"/"Copy failed"로 이어붙어야 한다 — 유닛 단언이
	// element.textContent 부분 일치로 상태를 본다.
	const showStatus = (text: string, mark = ""): void => {
		hintMark.textContent = mark;
		hintText.data = mark ? ` ${text}` : text;
		hint.hidden = false;
	};
	const clearStatus = (): void => {
		hintMark.textContent = "";
		hintText.data = "";
		hint.hidden = true;
	};

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
		deps.onClosed?.();
	};

	const open = (options: GrabOpenOptions): void => {
		label.textContent = options.label;
		label.title = options.labelTitle;
		// options.buildOutput을 그대로 tear-off하지 않고 래핑 호출한다
		// (oxlint unbound-method — 인터페이스 메서드 시그니처의 this 바인딩 경고).
		buildOutput = (prompt) => options.buildOutput(prompt);
		element.style.left = `${options.placement.left}px`;
		element.style.top = `${options.placement.top}px`;
		input.value = "";
		clearStatus();
		clearAutoCloseTimer();
		opened = true;
		element.hidden = false;
		input.focus();
	};

	const onCopySuccess = (): void => {
		showStatus(HINT_COPIED, HINT_COPIED_MARK);
		deps.onCopied?.();
		clearAutoCloseTimer();
		autoCloseTimer = setTimeout(() => {
			autoCloseTimer = null;
			close();
		}, AUTO_CLOSE_MS);
	};

	const onCopyFailure = (err: unknown): void => {
		showStatus(HINT_FAILED);
		console.warn(err);
	};

	const submit = (): void => {
		const output = buildOutput?.(input.value) ?? "";
		deps.writeText(output).then(onCopySuccess, onCopyFailure);
	};

	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			if (event.isComposing || event.keyCode === 229) return;
			// Shift+Enter는 개행 — preventDefault를 부르지 않고 그냥 빠져나가
			// textarea의 기본 동작에 맡긴다. 새 키 분기를 만들지 않는다.
			if (event.shiftKey) return;
			// 맨 Enter는 제출이므로 기본 동작(개행 삽입)을 막아야 한다.
			// <input>일 땐 Enter에 기본 동작이 없어 필요 없던 호출이다 —
			// textarea로 바꾸면서 생긴 요구사항이고, happy-dom은 기본 동작을
			// 수행하지 않아 유닛만으로는 드러나지 않는다(취소 여부로 단언한다).
			event.preventDefault();
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
