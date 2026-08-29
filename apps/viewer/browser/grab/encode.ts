// 클립보드로 나갈 최종 인코딩 문구. 펜스는 내용의 최장 백틱 런 + 1(최소 3)로
// 승격해 스니펫 내 ``` 충돌을 막는다. 프롬프트는 펜스 밖 마지막 줄.
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
	snippet: Snippet;
	prompt: string;
}

const fmtRange = (start: number, end: number): string =>
	start === end ? `${start}` : `${start}-${end}`;

const sideText = (side: "old" | "new"): string =>
	side === "new" ? "new side" : "old side";

const modeText = (mode: "working" | "base", baseName: string): string => {
	if (mode !== "base") return "working diff";
	return baseName ? `base diff vs ${baseName}` : "base diff";
};

const statusSuffix = (status: GrabFileStatus): string =>
	status === "modified" || status === "renamed" ? "" : `, ${status}`;

// 라벨은 팝오버에서 세 톤으로 칠해진다(파일명 밝게 / 라인 범위 파랑 / side
// 초록·빨강) — 셋이 서로 다른 종류의 정보라는 걸 색이 말한다. 그래서 문자열이
// 아니라 조각으로 돌려주고, 문자열이 필요한 곳은 grabLabel()이 이어 붙인다.
// 두 함수가 같은 출처를 쓰므로 색과 텍스트가 갈라질 수 없다.
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

export const grabLabel = (path: string, snippet: Snippet): string =>
	grabLabelParts(path, snippet)
		.map((part) => part.text)
		.join("");

// ⌥⏎ 단순 복사용 — 잡은 줄의 코드 텍스트만 나간다. 펜스·File:/Lines: 머리말·
// 프롬프트 전부 없이 편집기에 바로 붙여넣을 수 있는 형태. mixed의 +/- 마커도
// 싣지 않는다 — 맥락(헤더)이 빠진 텍스트에 마커만 남으면 노이즈다.
export const plainSnippet = (snippet: Snippet): string =>
	snippet.kind === "side"
		? snippet.lines.join("\n")
		: snippet.rows.map((r) => r.text).join("\n");

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
		snippet.kind === "side"
			? snippet.lines
			: snippet.rows.map((r) => `${r.marker}${r.text}`);
	const content = ["diffdeck selection", fileLine, linesLine, "", ...body].join(
		"\n",
	);
	const runs = content.match(/`+/g) ?? [];
	const fence = "`".repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
	const prompt = input.prompt.trim();
	return `${fence}\n${content}\n${fence}${prompt ? `\n${prompt}` : ""}`;
};
