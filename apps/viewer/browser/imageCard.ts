import { DIFFS_CHANGE_ICON_ATTR, DIFFS_HEADER_ATTR } from "@diffdeck/diffs";
import type { ImageEntry } from "./imageDiff.ts";

export type BlobUrlFor = (
	path: string,
	side: "old" | "new",
	version?: string,
) => string;

// 카드는 shadow DOM 안에 들어가 페이지 CSS가 닿지 않으므로 CodeView의
// unsafeCSS로 넣는다.
export const IMAGE_CARD_CSS =
	"[data-image-card]{display:flex;gap:1px;background:#1f1f21;border-top:1px solid #1f1f21}" +
	".img-pane{flex:1;margin:0;background:#141415;min-width:0}" +
	".img-pane figcaption{padding:4px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em}" +
	".img-pane--old figcaption{color:#e5534b}" +
	".img-pane--new figcaption{color:#57ab5a}" +
	".img-checker{display:flex;justify-content:center;align-items:center;padding:10px;" +
	"background:repeating-conic-gradient(#232324 0% 25%,#1a1a1b 0% 50%) 0 0/16px 16px}" +
	".img-checker img{max-width:100%;max-height:320px;object-fit:contain;display:block}" +
	".img-error{color:#8b8b93;font-size:12px;padding:24px 8px}";

const buildPane = (
	side: "old" | "new",
	src: string,
	alt: string,
): HTMLElement => {
	const pane = document.createElement("figure");
	pane.className = `img-pane img-pane--${side}`;
	const caption = document.createElement("figcaption");
	caption.textContent = side === "old" ? "Old" : "New";
	const checker = document.createElement("div");
	checker.className = "img-checker";
	const img = document.createElement("img");
	img.src = src;
	img.alt = alt;
	img.loading = "lazy";
	img.addEventListener(
		"error",
		() => {
			const note = img.ownerDocument.createElement("div");
			note.className = "img-error";
			note.textContent = "Couldn't load image";
			img.replaceWith(note);
		},
		{ once: true },
	);
	checker.append(img);
	pane.append(caption, checker);
	return pane;
};

const buildCard = (entry: ImageEntry, urlFor: BlobUrlFor): HTMLElement => {
	const card = document.createElement("div");
	card.setAttribute("data-image-card", entry.version ?? "");
	if (entry.showOld) {
		card.append(
			buildPane(
				"old",
				urlFor(entry.oldPath, "old", entry.version),
				`${entry.name} (old)`,
			),
		);
	}
	if (entry.showNew) {
		card.append(
			buildPane(
				"new",
				urlFor(entry.name, "new", entry.version),
				`${entry.name} (new)`,
			),
		);
	}
	return card;
};

// 이미지의 빈 diff는 헤더 아이콘이 늘 "modified"로 파싱되므로 실제 상태의
// 아이콘으로 바꾼다(스프라이트에 그 심볼이 있을 때만).
const ICON_SYMBOL: Partial<Record<ImageEntry["status"], string>> = {
	added: "added",
	untracked: "added",
	deleted: "deleted",
	renamed: "renamed",
};

const swapStatusIcon = (
	root: ShadowRoot | HTMLElement,
	status: ImageEntry["status"],
): void => {
	const symbol = ICON_SYMBOL[status];
	if (!symbol) return;
	if (!root.querySelector(`#diffs-icon-symbol-${symbol}`)) return;
	const use = root.querySelector<SVGUseElement>(
		`[${DIFFS_HEADER_ATTR}] [${DIFFS_CHANGE_ICON_ATTR}] use`,
	);
	use?.setAttribute("href", `#diffs-icon-symbol-${symbol}`);
};

// onPostRender마다 불리므로 멱등이다: 같은 version이면 그대로, 바뀌면 교체,
// 접혔으면 제거한다.
export const ensureImageCard = (
	container: HTMLElement,
	entry: ImageEntry | undefined,
	collapsed: boolean,
	urlFor: BlobUrlFor,
): void => {
	const root = container.shadowRoot ?? container;
	const existing = root.querySelector<HTMLElement>("[data-image-card]");
	if (!entry || collapsed) {
		existing?.remove();
		return;
	}
	// 이미지 아이템의 "-0 +0" 스탯은 무의미하므로 숨긴다.
	for (const el of root.querySelectorAll<HTMLElement>(
		"[data-deletions-count],[data-additions-count]",
	)) {
		el.style.display = "none";
	}
	swapStatusIcon(root, entry.status);
	const version = entry.version ?? "";
	if (existing) {
		if (existing.getAttribute("data-image-card") === version) return;
		existing.remove();
	}
	const header = root.querySelector(`[${DIFFS_HEADER_ATTR}]`);
	const card = buildCard(entry, urlFor);
	if (header) header.after(card);
	else root.append(card);
};
