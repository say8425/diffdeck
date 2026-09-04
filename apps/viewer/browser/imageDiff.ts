import type { DiffFile } from "../server/diff.ts";
import { isImagePath } from "../server/imageTypes.ts";

// 이미지 diff 카드 하나를 그리는 데 필요한 순수 데이터.
export interface ImageEntry {
	name: string;
	/** old 쪽 blob 경로 — renamed면 oldName, 아니면 name */
	oldPath: string;
	status: DiffFile["status"];
	showOld: boolean;
	showNew: boolean;
	/** 바이트 해시 — watch 갱신 감지 및 blob URL 캐시버스터 */
	version?: string;
}

export const imageEntries = (files: DiffFile[]): ImageEntry[] =>
	files
		.filter((f) => f.binary && isImagePath(f.name))
		.map((f) => {
			const entry: ImageEntry = {
				name: f.name,
				oldPath: f.oldName ?? f.name,
				status: f.status,
				showOld: f.status !== "added" && f.status !== "untracked",
				showNew: f.status !== "deleted",
			};
			if (f.blobVersion) entry.version = f.blobVersion;
			return entry;
		});

export const blobUrl = (params: {
	repo: string;
	token: string;
	path: string;
	side: "old" | "new";
	mode: "working" | "base";
	/** 사용자가 고른 견줄 기준. 없으면 서버가 mode로 되돌아간다. */
	base?: string;
	/** head로 고른 브랜치. 없으면 워킹트리를 본다. */
	head?: string;
	version?: string;
}): string => {
	const query = new URLSearchParams({
		repo: params.repo,
		token: params.token,
		path: params.path,
		side: params.side,
		mode: params.mode,
	});
	// 이미지 카드와 텍스트 diff가 같은 비교를 보여줘야 한다 — 기준이 갈리면
	// 한쪽은 base를, 다른 쪽은 워킹트리를 보여준다.
	if (params.base) query.set("base", params.base);
	if (params.head) query.set("head", params.head);
	if (params.version) query.set("v", params.version);
	return `/api/blob?${query.toString()}`;
};
