// 클립보드로 나갈 최종 인코딩 문구. 펜스는 내용의 최장 백틱 런 + 1(최소 3)로
// 승격해 스니펫 내 ``` 충돌을 막는다. 프롬프트는 펜스 밖 마지막 줄.
import type { Snippet } from "./snippet.ts";

export type GrabFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface EncodeInput {
	path: string;
	prevPath?: string;
	status: GrabFileStatus;
	mode: "working" | "base";
	baseName: string;
	snippet: Snippet;
	prompt: string;
}

const fmtRange = (start: number, end: number): string =>
	start === end ? `${start}` : `${start}-${end}`;

const sideText = (side: "old" | "new"): string => (side === "new" ? "new side" : "old side");

const modeText = (mode: "working" | "base", baseName: string): string => {
	if (mode !== "base") return "working diff";
	return baseName ? `base diff vs ${baseName}` : "base diff";
};

const statusSuffix = (status: GrabFileStatus): string =>
	status === "modified" || status === "renamed" ? "" : `, ${status}`;

export const grabLabel = (path: string, snippet: Snippet): string => {
	const name = path.split("/").pop() ?? path;
	if (snippet.kind === "side") {
		return `${name}:${fmtRange(snippet.startLine, snippet.endLine)} · ${sideText(snippet.side)}`;
	}
	return `${name}: old ${fmtRange(snippet.oldStart, snippet.oldEnd)} / new ${fmtRange(snippet.newStart, snippet.newEnd)}`;
};

export const encodeGrab = (input: EncodeInput): string => {
	const { snippet } = input;
	const fileLine = input.prevPath
		? `File: ${input.path} (renamed from ${input.prevPath})`
		: `File: ${input.path}`;
	const meta = `${modeText(input.mode, input.baseName)}${statusSuffix(input.status)}`;
	const linesLine =
		snippet.kind === "side"
			? `Lines: ${fmtRange(snippet.startLine, snippet.endLine)} (${sideText(snippet.side)}, ${meta})`
			: `Lines: old ${fmtRange(snippet.oldStart, snippet.oldEnd)} / new ${fmtRange(snippet.newStart, snippet.newEnd)} (${meta})`;
	const body =
		snippet.kind === "side" ? snippet.lines : snippet.rows.map((r) => `${r.marker}${r.text}`);
	const content = ["diffdeck selection", fileLine, linesLine, "", ...body].join("\n");
	const runs = content.match(/`+/g) ?? [];
	const fence = "`".repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
	const prompt = input.prompt.trim();
	return `${fence}\n${content}\n${fence}${prompt ? `\n${prompt}` : ""}`;
};
