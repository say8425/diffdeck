import { findRanges } from "./highlight.ts";
import type { SearchMatch } from "./searchIndex.ts";

const HIT = "cc-find-hit";
const ACTIVE = "cc-find-hit--active";

const unwrap = (root: HTMLElement | ShadowRoot): void => {
	const marks = root.querySelectorAll<HTMLElement>(`mark.${HIT}`);
	for (const mark of marks) {
		const parent = mark.parentNode;
		if (!parent) continue;
		parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
		parent.normalize();
	}
};

const sideOf = (lineType: string | undefined): "additions" | "deletions" =>
	lineType?.includes("deletion") ? "deletions" : "additions";

// Match against the row's full text (the string searchIndex.ts counts), not per
// text node: token and word-diff spans split a line into many nodes, and a
// per-node search drops matches that cross them while the counter still
// reports them. Each match is then split into one <mark> per covered node.
export const highlightDom = (
	root: HTMLElement | ShadowRoot,
	query: string,
	active: SearchMatch | null,
	fileId: string,
): void => {
	unwrap(root);
	if (query === "") return;

	const lineEls = root.querySelectorAll<HTMLElement>("[data-line]");
	for (const lineEl of lineEls) {
		const lineNumber = Number(lineEl.dataset.line);
		if (!Number.isFinite(lineNumber)) continue;
		const side = sideOf(lineEl.dataset.lineType);
		const activeHere =
			active !== null &&
			active.fileId === fileId &&
			active.side === side &&
			active.lineNumber === lineNumber;

		const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
		const nodes: { node: Text; offset: number }[] = [];
		let lineOffset = 0;
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const textNode = n as Text;
			const len = textNode.nodeValue?.length ?? 0;
			if (len > 0) nodes.push({ node: textNode, offset: lineOffset });
			lineOffset += len;
		}

		const fullText = nodes.map(({ node }) => node.nodeValue ?? "").join("");
		const ranges = findRanges(fullText, query);
		if (ranges.length === 0) continue;

		// Both lists are sorted, so keep a cursor instead of rescanning ranges per
		// node — this runs on every post-render while find is open.
		let firstLiveRange = 0;
		for (const { node, offset } of nodes) {
			const text = node.nodeValue ?? "";
			const nodeEnd = offset + text.length;
			while (
				firstLiveRange < ranges.length &&
				ranges[firstLiveRange].start + ranges[firstLiveRange].length <= offset
			) {
				firstLiveRange++;
			}
			const segments: { start: number; end: number; isActive: boolean }[] = [];
			for (let i = firstLiveRange; i < ranges.length; i++) {
				const range = ranges[i];
				const rangeEnd = range.start + range.length;
				if (range.start >= nodeEnd) break;
				segments.push({
					start: Math.max(range.start, offset) - offset,
					end: Math.min(rangeEnd, nodeEnd) - offset,
					isActive: activeHere && active.column === range.start,
				});
			}
			if (segments.length === 0) continue;

			const frag = document.createDocumentFragment();
			let cursor = 0;
			for (const segment of segments) {
				if (segment.start > cursor) {
					frag.appendChild(
						document.createTextNode(text.slice(cursor, segment.start)),
					);
				}
				const mark = document.createElement("mark");
				mark.className = HIT;
				mark.textContent = text.slice(segment.start, segment.end);
				if (segment.isActive) mark.classList.add(ACTIVE);
				frag.appendChild(mark);
				cursor = segment.end;
			}
			if (cursor < text.length)
				frag.appendChild(document.createTextNode(text.slice(cursor)));
			node.parentNode?.replaceChild(frag, node);
		}
	}
};
