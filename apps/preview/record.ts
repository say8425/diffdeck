import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { imageEntries } from "../viewer/browser/imageDiff.ts";
import type { DiffFile } from "../viewer/server/diff.ts";
import type { PrsByBranch } from "../viewer/server/prs.ts";
import { startDiffServer } from "../viewer/server/server.ts";
import {
	REPLAYED_HEADERS,
	SNAPSHOT_DIR,
	type SnapshotEntry,
	type SnapshotManifest,
	snapshotKey,
} from "./snapshot.ts";

export interface RecordOptions {
	repo: string;
	/** 빌드된 뷰어(`apps/viewer/dist/viewer`). 사이트 루트로 복사한다. */
	viewerDir: string;
	outDir: string;
	base: string;
	listPrs?: (repo: string) => Promise<PrsByBranch | null>;
}

// 실제 서버를 띄워 뷰어가 첫 화면에서 부르는 API를 그대로 불러 담는다.
// 응답을 손으로 만들지 않아야 프리뷰가 이 커밋의 서버 동작을 보인다.
export const recordSnapshot = async (
	opts: RecordOptions,
): Promise<SnapshotManifest> => {
	const repo = resolve(opts.repo);
	const snapshotDir = join(opts.outDir, SNAPSHOT_DIR);
	rmSync(opts.outDir, { recursive: true, force: true });
	cpSync(opts.viewerDir, opts.outDir, { recursive: true });
	mkdirSync(snapshotDir, { recursive: true });

	// 토큰 파일이 사용자의 캐시 디렉터리에 남지 않게 한다.
	const cacheHome = mkdtempSync(join(tmpdir(), "dd-preview-"));
	const handle = startDiffServer({
		port: 0,
		viewerDir: resolve(opts.viewerDir),
		env: { ...process.env, XDG_CACHE_HOME: cacheHome },
		...(opts.listPrs ? { listPrs: opts.listPrs } : {}),
	});
	const origin = `http://127.0.0.1:${handle.server.port}`;
	const entries: Record<string, SnapshotEntry> = {};

	const record = async (path: string, params: Record<string, string> = {}) => {
		const url = new URL(path, origin);
		for (const [k, v] of Object.entries({
			repo,
			token: handle.token,
			...params,
		})) {
			url.searchParams.set(k, v);
		}
		const res = await fetch(url);
		const body = new Uint8Array(await res.arrayBuffer());
		const headers: Record<string, string> = {};
		for (const name of REPLAYED_HEADERS) {
			const value = res.headers.get(name);
			if (value !== null) headers[name] = value;
		}
		const index = Object.keys(entries).length;
		const file = res.status === 204 ? null : `${index}.bin`;
		if (file) writeFileSync(join(snapshotDir, file), body);
		const key = snapshotKey(url);
		if (!key) throw new Error(`no snapshot key for ${url.pathname}`);
		entries[key] = { status: res.status, headers, file };
		return { status: res.status, body };
	};

	try {
		await record("/api/ping");
		await record("/api/refs");
		await record("/api/prs");
		await record("/api/summary", { base: opts.base });
		const diff = await record("/api/diff", {
			base: opts.base,
			untracked: "0",
		});
		if (diff.status === 200) {
			const files = JSON.parse(
				new TextDecoder().decode(diff.body),
			) as DiffFile[];
			const blobs: { path: string; side: "old" | "new" }[] = [];
			for (const e of imageEntries(files)) {
				if (e.showOld) blobs.push({ path: e.oldPath, side: "old" });
				if (e.showNew) blobs.push({ path: e.name, side: "new" });
			}
			for (const blob of blobs) {
				// 서버의 BUILD_CONCURRENCY를 겹쳐 쓰지 않게 하나씩 부른다(server.md).
				// oxlint-disable-next-line no-await-in-loop
				await record("/api/blob", { base: opts.base, mode: "base", ...blob });
			}
		}
	} finally {
		handle.stop();
		rmSync(cacheHome, { recursive: true, force: true });
	}

	const manifest: SnapshotManifest = { repo, base: opts.base, entries };
	writeFileSync(join(snapshotDir, "manifest.json"), JSON.stringify(manifest));
	return manifest;
};
