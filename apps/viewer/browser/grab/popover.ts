import type { GrabLabelPart } from "./encode.ts";
import type { Placement } from "./position.ts";

export interface GrabPopoverDeps {
	doc: Document;
	writeText(text: string): Promise<void>;
	onCopied?(): void;
	// close()의 모든 경로에서 불린다. 복사 성공 때는 onCopied 뒤에 한 번 더
	// 불리므로 둘 다 멱등이어야 한다.
	onClosed?(): void;
}

export interface GrabOpenOptions {
	label: GrabLabelPart[];
	labelTitle: string; // 전체 경로(라벨은 basename만 보인다)
	buildOutput(prompt: string): string;
	buildPlainOutput(): string;
	placement: Placement;
}

export interface GrabPopover {
	element: HTMLElement;
	open(options: GrabOpenOptions): void;
	close(): void;
	isOpen(): boolean;
	// 테스트용 — 같은 document에 문서 리스너가 쌓이지 않게 떼어 낸다.
	destroy(): void;
}

const HINT_COPIED = "Copied";
const HINT_FAILED = "Copy failed";
const SEND_LABEL = "Copy to clipboard";
const SEND_TITLE = "Copy (⏎) · Shift+⏎ for new line · ⌥⏎ for plain code";
const KEYS_KEY = "⌥⏎";
const KEYS_TEXT = "Copy code only";
// #find-close("Close search")와 달리 이름에 대상을 넣지 않는다 — 다이얼로그
// 안의 버튼이다.
const CLOSE_LABEL = "Close";
const CLOSE_TITLE = "Close (Esc)";
// 성공 체크를 확인시킬 최소 체류 시간 — 일부러 짧게 둔다.
const AUTO_CLOSE_MS = 400;

// 아이콘은 전부 DOM에 두고 data-state로 CSS가 하나만 보인다 — 상태마다
// innerHTML을 갈면 매번 파서를 태운다.
const ICONS =
	'<svg class="i-send" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>' +
	'<svg class="i-ok" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>' +
	'<svg class="i-fail" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 17h.01" /></svg>';

const CLOSE_ICON =
	'<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>';

type SendState = "idle" | "ready" | "ok" | "fail";

// 같은 document에 인스턴스가 여럿 생기면(테스트) aria-labelledby id가 겹쳐
// 엉뚱한 라벨을 읽는다.
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

	// 닫기 버튼은 라벨 줄 안에 둔다 — 줄을 따로 세우면 팝오버가 높아져
	// main.ts의 POPOVER_SIZE도 바꿔야 한다.
	const closeBtn = doc.createElement("button");
	closeBtn.type = "button";
	closeBtn.className = "grab-close";
	closeBtn.setAttribute("aria-label", CLOSE_LABEL);
	closeBtn.title = CLOSE_TITLE;
	closeBtn.innerHTML = CLOSE_ICON;

	const head = doc.createElement("div");
	head.className = "grab-head";
	head.append(label, closeBtn);

	const field = doc.createElement("div");
	field.className = "grab-field";

	// 높이는 CSS field-sizing이 내용에 맞추므로 JS로 재지 않는다.
	const input = doc.createElement("textarea");
	input.rows = 1;
	input.className = "grab-input";
	// 단축키는 placeholder가 아니라 .grab-keys·버튼 title·aria-keyshortcuts가
	// 알린다(grab.md).
	input.placeholder = "Prompt…";
	input.setAttribute("aria-label", "Grab prompt");
	input.setAttribute("aria-keyshortcuts", "Enter Shift+Enter Alt+Enter Escape");

	const send = doc.createElement("button");
	send.type = "button";
	send.className = "grab-send";
	send.dataset.state = "idle";
	// 이름은 고정한다 — 상태는 라이브 리전이 알린다(둘 다 바뀌면 두 번 읽힌다).
	send.setAttribute("aria-label", SEND_LABEL);
	send.title = SEND_TITLE;
	send.innerHTML = ICONS;

	field.append(input, send);

	// 상시 각주와 상태 리전(.grab-hint)은 노드를 나눈다 — 겸용하면 실패 문구가
	// 안내를 지운다.
	const keys = doc.createElement("div");
	keys.className = "grab-keys";
	const keysKey = doc.createElement("span");
	keysKey.className = "grab-keys-k";
	keysKey.textContent = KEYS_KEY;
	keys.append(keysKey, ` ${KEYS_TEXT}`);

	// sr-only다 — 보이는 줄로 두면 복사할 때마다 창이 자라 코드가 밀린다.
	const hint = doc.createElement("span");
	hint.className = "grab-hint";
	hint.setAttribute("role", "status");
	hint.setAttribute("aria-live", "polite");

	const setSendState = (state: SendState): void => {
		send.dataset.state = state;
	};

	const showStatus = (text: string): void => {
		hint.textContent = text;
	};
	const clearStatus = (): void => {
		hint.textContent = "";
	};

	element.append(head, field, keys, hint);

	let opened = false;
	let buildOutput: ((prompt: string) => string) | null = null;
	let buildPlainOutput: (() => string) | null = null;
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
		label.replaceChildren(
			...options.label.map((part) => {
				const span = doc.createElement("span");
				span.className = `grab-l-${part.kind}`;
				span.textContent = part.text;
				return span;
			}),
		);
		label.title = options.labelTitle;
		// tear-off하지 않고 감싼다(oxlint unbound-method).
		buildOutput = (prompt) => options.buildOutput(prompt);
		buildPlainOutput = () => options.buildPlainOutput();
		element.style.left = `${options.placement.left}px`;
		element.style.top = `${options.placement.top}px`;
		input.value = "";
		clearStatus();
		setSendState("idle");
		clearAutoCloseTimer();
		opened = true;
		element.hidden = false;
		input.focus();
	};

	const onCopySuccess = (): void => {
		showStatus(HINT_COPIED);
		setSendState("ok");
		deps.onCopied?.();
		clearAutoCloseTimer();
		autoCloseTimer = setTimeout(() => {
			autoCloseTimer = null;
			close();
		}, AUTO_CLOSE_MS);
	};

	const onCopyFailure = (err: unknown): void => {
		showStatus(HINT_FAILED);
		setSendState("fail");
		console.warn(err);
	};

	const writeOutput = (output: string): void => {
		deps.writeText(output).then(onCopySuccess, onCopyFailure);
	};

	const submit = (): void => {
		writeOutput(buildOutput?.(input.value) ?? "");
	};

	const submitPlain = (): void => {
		writeOutput(buildPlainOutput?.() ?? "");
	};

	// 빈 프롬프트도 복사되므로 버튼을 비활성화하지 않고 강조만 바꾼다.
	input.addEventListener("input", () => {
		setSendState(input.value === "" ? "idle" : "ready");
	});

	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			// 분기 순서가 계약이다: IME 가드 → alt → shift → 제출
			// (grab.md).
			if (event.isComposing || event.keyCode === 229) return;
			if (event.altKey) {
				event.preventDefault();
				submitPlain();
				return;
			}
			// Shift+Enter는 textarea의 기본 동작(개행)에 맡긴다.
			if (event.shiftKey) return;
			event.preventDefault();
			submit();
		} else if (event.key === "Escape") {
			if (event.isComposing || event.keyCode === 229) return;
			close();
		}
	});

	// 입력 포커스를 지킨다 — 포커스가 빠지면 IME 조합 중인 글자가 누락된다.
	send.addEventListener("mousedown", (event) => {
		event.preventDefault();
	});
	send.addEventListener("click", () => {
		submit();
	});
	// 보내기 버튼과 같다. 포커스 정리(input.blur)는 close()가 맡는다.
	closeBtn.addEventListener("mousedown", (event) => {
		event.preventDefault();
	});
	closeBtn.addEventListener("click", () => {
		close();
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
