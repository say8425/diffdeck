// 녹화(record.ts)와 재생(worker.ts)이 공유하는 스냅숏 형식이다.

export const SNAPSHOT_DIR = "_snapshot";
export const MANIFEST_PATH = `/${SNAPSHOT_DIR}/manifest.json`;

export interface SnapshotEntry {
	status: number;
	headers: Record<string, string>;
	/** `SNAPSHOT_DIR` 안의 본문 파일. 본문이 없는 응답(204·304)은 null이다. */
	file: string | null;
}

export interface SnapshotManifest {
	/** 녹화한 리포의 절대경로. 뷰어 URL의 `repo`로 그대로 쓴다. */
	repo: string;
	base: string;
	entries: Record<string, SnapshotEntry>;
}

// 재생에 실리는 헤더만 남긴다. 뷰어가 읽는 것(etag·x-diff-*·x-diffdeck*)과
// 본문 해석에 필요한 content-type이다.
export const REPLAYED_HEADERS = [
	"content-type",
	"etag",
	"x-diff-base",
	"x-diff-error",
	"x-diffdeck",
	"x-diffdeck-version",
] as const;

// 스냅숏은 선택 하나(녹화한 base, 워킹트리 head)만 담는다. 그래서 키에서
// repo·token·base·untracked를 버린다. 깨끗한 체크아웃이라 untracked는 결과를
// 바꾸지 않는다. blob만 파일과 side로 갈린다.
export const snapshotKey = (url: URL): string | null => {
	switch (url.pathname) {
		case "/api/ping":
		case "/api/diff":
		case "/api/summary":
		case "/api/refs":
		case "/api/prs":
			return url.pathname;
		case "/api/blob": {
			const path = url.searchParams.get("path");
			if (!path) return null;
			const side = url.searchParams.get("side") === "old" ? "old" : "new";
			return `/api/blob:${side}:${path}`;
		}
		default:
			return null;
	}
};
