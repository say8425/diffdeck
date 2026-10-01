import type { DiffFile } from "../server/diff.ts";
import { isImagePath } from "../server/imageTypes.ts";

export interface ImageEntry {
	name: string;
	oldPath: string;
	status: DiffFile["status"];
	showOld: boolean;
	showNew: boolean;
	/** 바이트 해시 — 카드 교체 판정과 blob URL 캐시버스터 */
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
	base?: string;
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
	// /api/diff와 같은 선택(base·head)을 실어야 이미지 카드가 같은 비교를 보인다.
	if (params.base) query.set("base", params.base);
	if (params.head) query.set("head", params.head);
	if (params.version) query.set("v", params.version);
	return `/api/blob?${query.toString()}`;
};
