// (side,라인범위) → 텍스트 재구성. DOM 무관·가상화 무관: isPartial=false 불변식
// (additionLines[i] = new i+1행, deletionLines[i] = old i+1행)에만 의존한다.
// buildGrabRows는 search/searchIndex.ts buildRows의 양측-커서 확장판 — hunk 사이
// gap 커서는 각 hunk의 deletionStart/additionStart로 재설정(per-gap 델타).
import type { FileDiffMetadata } from "@diffdeck/diffs";
import type { GrabPoint, GrabSide, NormalizedRange } from "./range.ts";

export interface SnippetRow {
	marker: "-" | "+" | " ";
	text: string;
	oldNo: number | null;
	newNo: number | null;
}

export type Snippet =
	| {
			kind: "side";
			side: GrabSide;
			startLine: number;
			endLine: number;
			lines: string[];
	  }
	| {
			kind: "mixed";
			oldStart: number;
			oldEnd: number;
			newStart: number;
			newEnd: number;
			rows: SnippetRow[];
	  };

const stripEol = (line: string): string => line.replace(/\r?\n$/, "");

export const buildGrabRows = (fileDiff: FileDiffMetadata): SnippetRow[] => {
	const { additionLines, deletionLines, hunks } = fileDiff;
	const rows: SnippetRow[] = [];
	const pushContext = (oldIdx: number, newIdx: number, count: number): void => {
		for (let i = 0; i < count; i++) {
			const o = oldIdx + i;
			const n = newIdx + i;
			if (
				o < 0 ||
				o >= deletionLines.length ||
				n < 0 ||
				n >= additionLines.length
			)
				continue;
			rows.push({
				marker: " ",
				text: stripEol(additionLines[n]),
				oldNo: o + 1,
				newNo: n + 1,
			});
		}
	};
	let oldCursor = 0;
	let newCursor = 0;
	for (const hunk of hunks) {
		const hunkNewStart = hunk.additionStart - 1;
		if (hunkNewStart > newCursor)
			pushContext(oldCursor, newCursor, hunkNewStart - newCursor);
		oldCursor = hunk.deletionStart - 1;
		newCursor = hunkNewStart;
		for (const content of hunk.hunkContent) {
			if (content.type === "context") {
				pushContext(
					content.deletionLineIndex,
					content.additionLineIndex,
					content.lines,
				);
				oldCursor = content.deletionLineIndex + content.lines;
				newCursor = content.additionLineIndex + content.lines;
			} else {
				for (let i = 0; i < content.deletions; i++) {
					const o = content.deletionLineIndex + i;
					if (o < 0 || o >= deletionLines.length) continue;
					rows.push({
						marker: "-",
						text: stripEol(deletionLines[o]),
						oldNo: o + 1,
						newNo: null,
					});
				}
				for (let i = 0; i < content.additions; i++) {
					const n = content.additionLineIndex + i;
					if (n < 0 || n >= additionLines.length) continue;
					rows.push({
						marker: "+",
						text: stripEol(additionLines[n]),
						oldNo: null,
						newNo: n + 1,
					});
				}
				oldCursor = content.deletionLineIndex + content.deletions;
				newCursor = content.additionLineIndex + content.additions;
			}
		}
	}
	if (newCursor < additionLines.length)
		pushContext(oldCursor, newCursor, additionLines.length - newCursor);
	return rows;
};

const rowIndexOf = (rows: readonly SnippetRow[], point: GrabPoint): number =>
	rows.findIndex((r) =>
		point.side === "old" ? r.oldNo === point.line : r.newNo === point.line,
	);

export const extractSnippet = (
	fileDiff: FileDiffMetadata,
	range: NormalizedRange,
): Snippet | null => {
	if (range.kind === "side") {
		const arr =
			range.side === "old" ? fileDiff.deletionLines : fileDiff.additionLines;
		if (arr.length === 0) return null;
		const startLine = Math.min(Math.max(range.startLine, 1), arr.length);
		const endLine = Math.min(Math.max(range.endLine, startLine), arr.length);
		return {
			kind: "side",
			side: range.side,
			startLine,
			endLine,
			lines: arr.slice(startLine - 1, endLine).map(stripEol),
		};
	}
	const all = buildGrabRows(fileDiff);
	const i = rowIndexOf(all, range.start);
	const j = rowIndexOf(all, range.end);
	if (i < 0 || j < 0) return null;
	const rows = all.slice(Math.min(i, j), Math.max(i, j) + 1);
	let oldStart = Number.POSITIVE_INFINITY;
	let oldEnd = 0;
	let newStart = Number.POSITIVE_INFINITY;
	let newEnd = 0;
	for (const r of rows) {
		if (r.oldNo !== null) {
			oldStart = Math.min(oldStart, r.oldNo);
			oldEnd = Math.max(oldEnd, r.oldNo);
		}
		if (r.newNo !== null) {
			newStart = Math.min(newStart, r.newNo);
			newEnd = Math.max(newEnd, r.newNo);
		}
	}
	return { kind: "mixed", oldStart, oldEnd, newStart, newEnd, rows };
};
