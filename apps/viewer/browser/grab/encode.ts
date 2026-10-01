import type { Snippet } from "./snippet.ts";

export type GrabFileStatus =
	| "modified"
	| "added"
	| "deleted"
	| "renamed"
	| "untracked";

export interface EncodeInput {
	path: string;
	prevPath?: string;
	status: GrabFileStatus;
	mode: "working" | "base";
	baseName: string;
	// 빠지면 붙여넣기를 받은 에이전트가 자기 워킹트리의 같은 경로를 연다 —
	// head로 본 브랜치의 커밋된 내용과 다를 수 있다.
	head?: string;
	snippet: Snippet;
	prompt: string;
}

const fmtRange = (start: number, end: number): string =>
	start === end ? `${start}` : `${start}-${end}`;

const sideText = (side: "old" | "new"): string =>
	side === "new" ? "new side" : "old side";

const modeText = (
	mode: "working" | "base",
	baseName: string,
	head?: string,
): string => {
	const at = head ? ` on ${head}` : "";
	if (mode !== "base") return `working diff${at}`;
	return baseName ? `base diff vs ${baseName}${at}` : `base diff${at}`;
};

const statusSuffix = (status: GrabFileStatus): string =>
	status === "modified" || status === "renamed" ? "" : `, ${status}`;

export type GrabLabelKind = "file" | "range" | "sep" | "side" | "side-old";

export interface GrabLabelPart {
	text: string;
	kind: GrabLabelKind;
}

export const grabLabelParts = (
	path: string,
	snippet: Snippet,
): GrabLabelPart[] => {
	const name = path.split("/").pop() ?? path;
	if (snippet.kind === "side") {
		return [
			{ text: name, kind: "file" },
			{
				text: `:${fmtRange(snippet.startLine, snippet.endLine)}`,
				kind: "range",
			},
			{ text: " · ", kind: "sep" },
			{
				text: sideText(snippet.side),
				kind: snippet.side === "new" ? "side" : "side-old",
			},
		];
	}
	return [
		{ text: name, kind: "file" },
		{ text: ": ", kind: "sep" },
		{
			text: `old ${fmtRange(snippet.oldStart, snippet.oldEnd)}`,
			kind: "side-old",
		},
		{ text: " / ", kind: "sep" },
		{ text: `new ${fmtRange(snippet.newStart, snippet.newEnd)}`, kind: "side" },
	];
};

// 프로덕션에서 부르지 않지만 지우지 않는다 — 테스트가 이 함수로 조각을 이어
// 붙인 문자열을 단언한다(grab.md).
export const grabLabel = (path: string, snippet: Snippet): string =>
	grabLabelParts(path, snippet)
		.map((part) => part.text)
		.join("");

// ⌥⏎용. mixed의 +/- 마커도 싣지 않는다 — 머리말 없이 마커만 남으면 노이즈다.
export const plainSnippet = (snippet: Snippet): string =>
	snippet.kind === "side"
		? snippet.lines.join("\n")
		: snippet.rows.map((r) => r.text).join("\n");

export const encodeGrab = (input: EncodeInput): string => {
	const { snippet } = input;
	const fileLine = input.prevPath
		? `File: ${input.path} (renamed from ${input.prevPath})`
		: `File: ${input.path}`;
	const meta = `${modeText(input.mode, input.baseName, input.head)}${statusSuffix(input.status)}`;
	const linesLine =
		snippet.kind === "side"
			? `Lines: ${fmtRange(snippet.startLine, snippet.endLine)} (${sideText(snippet.side)}, ${meta})`
			: `Lines: old ${fmtRange(snippet.oldStart, snippet.oldEnd)} / new ${fmtRange(snippet.newStart, snippet.newEnd)} (${meta})`;
	const body =
		snippet.kind === "side"
			? snippet.lines
			: snippet.rows.map((r) => `${r.marker}${r.text}`);
	const content = ["diffdeck selection", fileLine, linesLine, "", ...body].join(
		"\n",
	);
	// 펜스를 내용의 가장 긴 백틱 런보다 길게 잡아 스니펫 안의 ```와 겹치지
	// 않게 한다.
	const runs = content.match(/`+/g) ?? [];
	const fence = "`".repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
	const prompt = input.prompt.trim();
	return `${fence}\n${content}\n${fence}${prompt ? `\n${prompt}` : ""}`;
};
