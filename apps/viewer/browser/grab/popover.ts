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

// ↵ (corner-down-left) — 제출. 글리프가 아니라 SVG인 이유: 10px 평문 글리프는
// 옆 텍스트와 베이스라인이 어긋난다(copyButton.ts와 같은 판단).
const SUBMIT_SVG =
	'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>';
const CHECK_SVG =
	'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
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

	const input = doc.createElement("input");
	input.type = "text";
	input.className = "grab-input";
	// Enter 고지는 제출 버튼의 title/aria가 맡는다 — placeholder와 이중으로
	// 말하지 않는다(그게 힌트 줄이 어색했던 기계적 원인이다).
	input.placeholder = "Prompt…";
	input.setAttribute("aria-label", "Grab prompt");
	input.setAttribute("aria-keyshortcuts", "Escape");

	const submitBtn = doc.createElement("button");
	submitBtn.type = "button";
	submitBtn.className = "grab-submit";
	submitBtn.setAttribute("aria-keyshortcuts", "Enter");

	const row = doc.createElement("div");
	row.className = "grab-row";
	row.append(input, submitBtn);

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

	const setSubmitState = (copied: boolean): void => {
		submitBtn.innerHTML = copied ? CHECK_SVG : SUBMIT_SVG;
		submitBtn.setAttribute("aria-label", copied ? "Copied" : "Copy grab");
		submitBtn.setAttribute("title", copied ? "Copied" : "Copy (Enter)");
	};

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

	setSubmitState(false);
	element.append(label, row, hint);

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
		setSubmitState(false);
		clearAutoCloseTimer();
		opened = true;
		element.hidden = false;
		input.focus();
	};

	const onCopySuccess = (): void => {
		showStatus(HINT_COPIED, HINT_COPIED_MARK);
		setSubmitState(true);
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

	submitBtn.addEventListener("click", () => submit());

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
