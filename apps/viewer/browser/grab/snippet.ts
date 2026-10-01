// isPartial=false(파일 전량으로 만든 diff)에 기댄다: additionLines[i]가 new
// i+1행, deletionLines[i]가 old i+1행이다. buildGrabRows는
// search/searchIndex.ts의 buildRows를 old/new 양쪽 커서로 넓힌 것이다.
import type { FileDiffMetadata } from "@diffdeck/diffs";
import type {
	CharSpan,
	GrabPoint,
	GrabSide,
	NormalizedRange,
} from "./range.ts";

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

const applyChars = (lines: readonly string[], chars?: CharSpan): string[] => {
	if (!chars || lines.length === 0) return [...lines];
	if (lines.length === 1) return [lines[0].slice(chars.start, chars.end)];
	const out = [...lines];
	out[0] = out[0].slice(chars.start);
	out[out.length - 1] = out[out.length - 1].slice(0, chars.end);
	return out;
};

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
			lines: applyChars(
				arr.slice(startLine - 1, endLine).map(stripEol),
				range.chars,
			),
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
	const sliced = applyChars(
		rows.map((r) => r.text),
		range.chars,
	);
	const outRows: SnippetRow[] = rows.map((r, k) => ({
		marker: r.marker,
		text: sliced[k],
		oldNo: r.oldNo,
		newNo: r.newNo,
	}));
	return { kind: "mixed", oldStart, oldEnd, newStart, newEnd, rows: outRows };
};
