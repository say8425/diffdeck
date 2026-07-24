import { resolve } from "node:path";
import type { Server } from "bun";
import packageJson from "../package.json";
import {
	getDiffFiles,
	getFileBytes,
	isGitRepo,
	resolveBaseRef,
} from "./diff.ts";
import { repoFingerprint } from "./fingerprint.ts";
import { imageContentType, isImagePath } from "./imageTypes.ts";
import {
	createPayloadCache,
	type PayloadCacheEntry,
	payloadEtag,
} from "./payloadCache.ts";
import { createSingleFlight } from "./singleFlight.ts";
import { generateToken, persistToken, readTokenSync } from "./token.ts";

type Env = Record<string, string | undefined>;

export interface DiffServerHandle {
	server: Server<undefined>;
	token: string;
	stop(): void;
}

// Base resolution runs `gh pr view`, which is slow — cache it per repo.
const BASE_TTL_MS = 10_000;
const baseCache = new Map<
	string,
	{ value: { base: string | null; ref: string | null }; at: number }
>();

// 동시 콜드 요청(프리워밍 + 첫 화면 + 폴)이 gh pr view를 중복 실행하지 않게
// single-flight로 합류시킨다.
const baseFlight = createSingleFlight<{
	base: string | null;
	ref: string | null;
}>();

const resolveBaseCached = (
	repo: string,
): Promise<{ base: string | null; ref: string | null }> =>
	baseFlight(repo, async () => {
		const now = Date.now();
		const hit = baseCache.get(repo);
		if (hit && now - hit.at < BASE_TTL_MS) return hit.value;
		const value = await resolveBaseRef(repo);
		baseCache.set(repo, { value, at: now });
		return value;
	});

const createHandler = (cfg: { viewerDir: string; token: string }) => {
	const viewerRoot = resolve(cfg.viewerDir);
	const diffCache = createPayloadCache();
	// 같은 (repo, untracked, mode)의 지문 계산+파이프라인을 동시에 한 번만 —
	// 콜드 상태에서 프리워밍과 첫 화면 요청이 겹쳐도 중복 실행되지 않는다.
	const diffFlight = createSingleFlight<PayloadCacheEntry>();
	return async (req: Request): Promise<Response> => {
		const url = new URL(req.url);

		if (url.pathname === "/api/ping") {
			return new Response(null, {
				status: 204,
				headers: {
					// The bare marker stays a constant: clients built before
					// versions were reported here match on it exactly.
					"x-diffdeck": "1",
					// A daemon is detached and outlives the install that spawned
					// it, so upgrading the package on disk does not upgrade what
					// answers this port. Report who we actually are so a client
					// can replace a stale daemon instead of reading any answer
					// as "up to date".
					//
					// This route is unauthenticated and any local process can
					// bind this port, so neither field is trustworthy on its own
					// — a client that signals a pid read from here would let a
					// squatter pick the victim. A client MUST first confirm the
					// responder holds the token it read from disk (a request
					// that would 403 otherwise); only a real daemon can pass
					// that, and only then is the pid its own.
					"x-diffdeck-version": packageJson.version,
					"x-diffdeck-pid": String(process.pid),
				},
			});
		}

		if (url.pathname === "/api/diff") {
			if (url.searchParams.get("token") !== cfg.token) {
				return new Response("forbidden", { status: 403 });
			}
			const repo = url.searchParams.get("repo") ?? "";
			if (!repo || !(await isGitRepo(repo))) {
				return new Response("not a git repository", { status: 400 });
			}
			const untracked = url.searchParams.get("untracked") === "1";
			const mode = url.searchParams.get("mode") === "base" ? "base" : "working";
			const { base, ref } = await resolveBaseCached(repo);
			// 파이프라인(파일당 git 서브프로세스) 전에 싼 지문으로 변경 여부를
			// 판정한다. 지문은 파이프라인 "이전"에 뜨므로, 그 사이에 리포가
			// 바뀌면 저장된 지문이 이미 낡은 값이 되어 다음 요청이 무조건
			// 재계산한다 — 낡은 payload가 눌러앉는 방향의 레이스는 없다.
			const cacheKey = `${repo}\0${untracked}\0${mode}`;
			const entry = await diffFlight(cacheKey, async () => {
				const fingerprint = await repoFingerprint(repo, {
					untracked,
					mode,
					ref: mode === "base" ? (ref ?? undefined) : undefined,
				});
				const cached = diffCache.get(cacheKey, fingerprint);
				if (cached) return cached;
				const files =
					mode === "base"
						? await getDiffFiles(repo, {
								untracked,
								mode: "base",
								ref: ref ?? undefined,
							})
						: await getDiffFiles(repo, { untracked });
				const fresh = {
					fingerprint,
					etag: payloadEtag(files),
					body: JSON.stringify(files),
				};
				diffCache.set(cacheKey, fresh);
				return fresh;
			});
			const etag = `"${entry.etag}"`;
			// 304에도 x-diff-base를 실어 클라이언트가 드롭다운 라벨을 유지한다.
			if (req.headers.get("if-none-match") === etag) {
				return new Response(null, {
					status: 304,
					headers: { etag, "x-diff-base": base ?? "" },
				});
			}
			// NOTE: intentionally no Access-Control-Allow-Origin — cross-origin pages must not read this.
			return new Response(entry.body, {
				headers: {
					"content-type": "application/json; charset=utf-8",
					"x-diff-base": base ?? "",
					etag,
				},
			});
		}

		if (url.pathname === "/api/blob") {
			if (url.searchParams.get("token") !== cfg.token) {
				return new Response("forbidden", { status: 403 });
			}
			const repo = url.searchParams.get("repo") ?? "";
			if (!repo || !(await isGitRepo(repo))) {
				return new Response("not a git repository", { status: 400 });
			}
			const path = url.searchParams.get("path") ?? "";
			// blob은 이미지 diff 전용 — 이미지 외 파일(빈 경로 포함)은 노출하지 않는다.
			if (!isImagePath(path)) {
				return new Response("not found", { status: 404 });
			}
			const side = url.searchParams.get("side") === "old" ? "old" : "new";
			const mode = url.searchParams.get("mode") === "base" ? "base" : "working";
			const ref = mode === "base" ? (await resolveBaseCached(repo)).ref : null;
			const bytes = await getFileBytes(
				repo,
				path,
				side,
				mode === "base" && ref ? { mode, ref } : {},
			);
			if (!bytes) return new Response("not found", { status: 404 });
			// no-store: 워킹트리 이미지는 저장할 때마다 바뀌므로 항상 새로 읽는다
			// (변경 감지는 blobVersion 캐시버스터가 담당).
			return new Response(bytes, {
				headers: {
					"content-type": imageContentType(path),
					"cache-control": "no-store",
				},
			});
		}

		const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
		const filePath = resolve(viewerRoot, rel);
		if (filePath !== viewerRoot && !filePath.startsWith(`${viewerRoot}/`)) {
			return new Response("forbidden", { status: 403 });
		}
		const file = Bun.file(filePath);
		// no-store: the viewer bundle is served from disk and changes on rebuild/
		// package update; never let the browser run a stale cached copy.
		if (await file.exists()) {
			return new Response(file, { headers: { "cache-control": "no-store" } });
		}
		return new Response("not found", { status: 404 });
	};
};

export const startDiffServer = (opts: {
	port: number;
	viewerDir: string;
	env?: Env;
}): DiffServerHandle => {
	const env = opts.env ?? process.env;
	// Mint the token but don't write it yet — Bun.serve throws if the port is
	// taken, and a token on disk is what tells a client a daemon is usable
	// here. Writing first would leave one pointing at whoever owns the port
	// (which rejects it), so bind first and only then publish.
	const existing = readTokenSync(env);
	const token = existing ?? generateToken();
	const handler = createHandler({ viewerDir: opts.viewerDir, token });
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: opts.port,
		// Bun.serve 기본 idleTimeout(10초)은 콜드스타트 자원 경합(브라우저 기동
		// + prewarm git 서브프로세스 버스트)으로 첫 diff 응답이 10초를 넘는 순간
		// 커넥션을 강제 종료한다("request timed out after 10 seconds"). 클라이언트
		// fetchDiff엔 재시도가 없어 뷰어가 "Loading…"에 영구 고착되는 행이 됐다
		// (경합 시 간헐 재현). 평시 응답은 1초대이므로 60초는 순수 여유분이다.
		idleTimeout: 60,
		fetch: handler,
	});
	if (existing == null) persistToken(token, env);
	const stop = (): void => {
		void server.stop(true);
	};
	return { server, token, stop };
};
