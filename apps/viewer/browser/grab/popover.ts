// diff-grab 프롬프트 입력 팝오버 — 거터 "+" 클릭 또는 텍스트 드래그 릴리스
// 시 뜬다. 요소는 항상 DOM에 붙어있고(hidden 토글) main이 body에 append한다 —
// findBar.ts와 동일하게 리스너는 생성 시 등록, destroy()에서 해제(happy-dom
// 전역 window 누적 방지).
//
// 구조는 라벨 한 줄 + 입력 영역 둘뿐이고, 보내기 버튼은 입력 영역 **안**에 산다:
//
//   ┌ #grab-popover ────────────────┐  8px  ← 떠 있는 패널(앱에서 유일)
//   │ popover.ts:53 · new side      │
//   │ ┌ .grab-field ──────────────┐ │  6px  ← --vd-radius, 표준 컨트롤
//   │ │ textarea        [.grab-send]│ │  4px  ← 컨테이너 안쪽 버튼
//   │ └───────────────────────────┘ │
//   └───────────────────────────────┘
//
// radius 8/6/4는 임의값이 아니라 앱에 이미 있는 세 값이다(툴바 세그먼트
// 컨트롤이 컨테이너 6 / 안쪽 버튼 4로 같은 규칙을 쓴다). 앱에서 999px은
// 토글 스위치 하나에만 배정돼 있어 여기서 쓰면 그 어휘를 훔치게 된다.
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
const HINT_FAILED = "Copy failed";
const SEND_LABEL = "Copy to clipboard";
const SEND_TITLE = "Copy (⏎) · Shift+⏎ for new line";
const AUTO_CLOSE_MS = 1200;

// 버튼 아이콘 셋. 세 개를 전부 DOM에 두고 data-state로 CSS가 하나만 보여준다 —
// 상태마다 innerHTML을 갈아끼우면 매번 파서를 태우고 재측정을 유발한다.
// 오른쪽 화살표("보낸다")이지 위쪽 화살표(업로드)가 아니다.
const ICONS =
	'<svg class="i-send" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>' +
	'<svg class="i-ok" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>' +
	'<svg class="i-fail" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 17h.01" /></svg>';

type SendState = "idle" | "ready" | "ok" | "fail";

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

	// 입력 영역 — 테두리·배경·radius는 이 래퍼가 갖는다. textarea는 그 안에서
	// 투명하게 눕고, 버튼이 같은 상자를 공유한다.
	const field = doc.createElement("div");
	field.className = "grab-field";

	// <input>이 아니라 <textarea>인 이유: 에이전트 프롬프트는 여러 줄이 자연스럽다.
	// Shift+Enter로 개행하고 Enter로 제출한다. 높이는 CSS field-sizing이 내용에
	// 맞춰 늘리므로(최대 높이 후 스크롤) 여기에 JS 측정 로직을 두지 않는다.
	const input = doc.createElement("textarea");
	input.rows = 1;
	input.className = "grab-input";
	// placeholder는 한 마디만 한다. 예전엔 여기에 "(⏎ copy · shift + ⏎ new
	// line)"까지 실어 입력창을 꽉 채웠는데, 그게 창에서 가장 눈에 띄는 요소라
	// 다른 걸 아무리 고쳐도 "안 바뀐 것처럼" 보였다. 단축키 고지는 이제 화면을
	// 차지하지 않는 두 채널이 맡는다 — 버튼 hover(title)와 aria-keyshortcuts.
	input.placeholder = "Prompt…";
	input.setAttribute("aria-label", "Grab prompt");
	input.setAttribute("aria-keyshortcuts", "Enter Shift+Enter Escape");

	// 보내기 버튼. 배경색이 없는 게 계약이다 — 색만 바뀐다(회색 → 액센트 →
	// 초록/빨강). 그래서 어느 상태에서도 창 크기가 변하지 않는다.
	const send = doc.createElement("button");
	send.type = "button";
	send.className = "grab-send";
	send.dataset.state = "idle";
	// 아이콘이 상태마다 바뀌어도 접근 가능한 이름은 고정한다 — 상태 자체는
	// 아래 라이브 리전이 알린다. 둘 다 바뀌면 스크린리더가 두 번 말한다.
	send.setAttribute("aria-label", SEND_LABEL);
	// hover에서만 보이므로 시각적 비용이 0이다 — placeholder에서 뺀 단축키
	// 안내가 갈 곳.
	send.title = SEND_TITLE;
	send.innerHTML = ICONS;

	field.append(input, send);

	// 상태 전용 라이브 리전. **시각적으로는 버튼이 상태를 지므로** 이 노드는
	// 스크린리더 전용(sr-only)이다. 예전처럼 눈에 보이는 줄로 두면 복사할
	// 때마다 창이 한 줄 자라 커서 아래 코드가 밀렸다(실측: 66 → 84px).
	const hint = doc.createElement("span");
	hint.className = "grab-hint";
	hint.setAttribute("role", "status");
	hint.setAttribute("aria-live", "polite");

	const setSendState = (state: SendState): void => {
		send.dataset.state = state;
	};

	// textContent가 "Copied"/"Copy failed"를 포함해야 한다 — 유닛 단언이
	// element.textContent 부분 일치로 상태를 본다.
	const showStatus = (text: string): void => {
		hint.textContent = text;
	};
	const clearStatus = (): void => {
		hint.textContent = "";
	};

	element.append(label, field, hint);

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

	const submit = (): void => {
		const output = buildOutput?.(input.value) ?? "";
		deps.writeText(output).then(onCopySuccess, onCopyFailure);
	};

	// 프롬프트가 비었는지에 따라 버튼 강조만 바뀐다. 비활성화하지는 않는다 —
	// 빈 프롬프트로도 참조+스니펫은 복사되므로 막으면 기능이 줄어든다.
	input.addEventListener("input", () => {
		setSendState(input.value === "" ? "idle" : "ready");
	});

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

	// 버튼을 눌러도 입력 포커스를 잃지 않게 한다. 포커스가 빠지면 IME 조합이
	// 강제 확정되고, 조합 중이던 글자가 프롬프트에서 누락된다.
	send.addEventListener("mousedown", (event) => {
		event.preventDefault();
	});
	send.addEventListener("click", () => {
		submit();
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
