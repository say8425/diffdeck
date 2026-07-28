import { findRanges } from "./highlight.ts";
import type { SearchMatch } from "./searchIndex.ts";

const HIT = "cc-find-hit";
const ACTIVE = "cc-find-hit--active";

/** Remove all mark.cc-find-hit wrappers under root, restoring original text. */
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

/**
 * Wrap query matches inside root's code content lines in <mark>. Idempotent:
 * unwraps previous marks first; empty query → unwrap only. Scopes to Pierre's
 * `[data-line]` rows (excludes the gutter) and derives each row's 1-based line
 * number and side.
 *
 * Matching runs against the row's FULL concatenated text — the same string
 * the search index counts on (searchIndex.ts) — not per text node: rendered
 * lines are fragmented into many text nodes by intraline word-diff spans and
 * (once async highlight lands) syntax token spans, so a per-node search
 * silently drops every match that crosses a node boundary while the counter
 * still reports it ("1/1" with nothing highlighted on screen). Each global
 * match range is split back into per-node segments, one <mark> per covered
 * segment — visually contiguous across span boundaries. The active occurrence
 * (fileId + side + lineNumber + column) carries `--active` on all of its
 * segments.
 */
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

		// Nodes and ranges are both sorted, so a range that ended before this
		// node's offset can never matter to a later node either — advance a
		// persistent cursor instead of rescanning from ranges[0] per node
		// (O(nodes + ranges), this runs on every post-render while find is open).
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
			// This node's slices of the global match ranges, in node-local
			// coordinates. Ranges are sorted and non-overlapping, so segments are
			// too.
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
