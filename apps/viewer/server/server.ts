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
import {
	createSingleFlight,
	SingleFlightTimeoutError,
} from "./singleFlight.ts";
import { getRepoSummary } from "./summary.ts";
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

// 플라이트가 타임아웃되면(= fn()이 settle하지 않았다는 신호, singleFlight.ts
// 참고) 요청을 무기한 매달아 두는 대신 503을 돌려준다. 짧은 Retry-After를
// 실어, 재시도가 "아직 매달려 있는 그 요청"이 아니라 새 요청임을 클라이언트가
// 신뢰하고 곧바로 다시 시도하게 한다 — 타임아웃이 곧 그 키를 이미 비웠으므로
// (createSingleFlight의 `.finally()`) 다음 호출은 새 플라이트로 시작한다.
const FLIGHT_TIMEOUT_RETRY_AFTER_SECONDS = 1;

const flightTimeoutResponse = (): Response =>
	new Response("diff pipeline busy, retry shortly", {
		status: 503,
		headers: { "retry-after": String(FLIGHT_TIMEOUT_RETRY_AFTER_SECONDS) },
	});

/**
 * single-flight 호출을 감싸 타임아웃만 503 Response로 흡수하고, 그 외
 * 에러는(현재 resolveBaseRef/getDiffFiles 경로는 전부 nothrow라 미도달이지만)
 * 그대로 다시 던져 기존 동작을 보존한다. 반환 타입이 `T | Response`라
 * 호출부는 `instanceof Response`로 좁혀 즉시 return하면 된다.
 */
export const awaitFlight = async <T>(
	promise: Promise<T>,
): Promise<T | Response> => {
	try {
		return await promise;
	} catch (err) {
		if (err instanceof SingleFlightTimeoutError) return flightTimeoutResponse();
		throw err;
	}
};

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
			const baseResult = await awaitFlight(resolveBaseCached(repo));
			if (baseResult instanceof Response) return baseResult;
			const { base, ref } = baseResult;
			// 파이프라인(파일당 git 서브프로세스) 전에 싼 지문으로 변경 여부를
			// 판정한다. 지문은 파이프라인 "이전"에 뜨므로, 그 사이에 리포가
			// 바뀌면 저장된 지문이 이미 낡은 값이 되어 다음 요청이 무조건
			// 재계산한다 — 낡은 payload가 눌러앉는 방향의 레이스는 없다.
			const cacheKey = `${repo}\0${untracked}\0${mode}`;
			const entryResult = await awaitFlight(
				diffFlight(cacheKey, async () => {
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
				}),
			);
			if (entryResult instanceof Response) return entryResult;
			const entry = entryResult;
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

		if (url.pathname === "/api/summary") {
			if (url.searchParams.get("token") !== cfg.token) {
				return new Response("forbidden", { status: 403 });
			}
			const repo = url.searchParams.get("repo") ?? "";
			if (!repo || !(await isGitRepo(repo))) {
				return new Response("not a git repository", { status: 400 });
			}
			const baseResult = await awaitFlight(resolveBaseCached(repo));
			if (baseResult instanceof Response) return baseResult;
			const { base, ref } = baseResult;
			const summary = await getRepoSummary(repo, { base, ref });
			// NOTE: /api/diff와 동일하게 CORS 헤더 없음 — cross-origin 페이지가 읽을 수 없다.
			return new Response(JSON.stringify(summary), {
				headers: { "content-type": "application/json; charset=utf-8" },
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
			let ref: string | null = null;
			if (mode === "base") {
				const baseResult = await awaitFlight(resolveBaseCached(repo));
				if (baseResult instanceof Response) return baseResult;
				ref = baseResult.ref;
			}
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
		// 커넥션을 강제 종료한다("request timed out after 10 seconds"). 평시
		// 응답은 1초대이므로 60초는 순수 여유분이다 — singleFlight의 기본
		// 타임아웃(30초, singleFlight.ts)이 응답을(정상이든 503이든) 실제로
		// 만들어 낼 시간을 이 60초 안에서 확보한다. 예전엔 fn()이 settle하지
		// 않을 때 이 값에 걸려도 클라이언트가 재시도하지 않아 뷰어가
		// "Loading…"에 영구 고착됐다 — 지금은 singleFlight 타임아웃이 503으로
		// 응답을 만들고, browser/main.ts의 fetchDiff가 그 503과 네트워크
		// 실패를 재시도해 자가 치유한다.
		idleTimeout: 60,
		fetch: handler,
	});
	if (existing == null) persistToken(token, env);
	const stop = (): void => {
		void server.stop(true);
	};
	return { server, token, stop };
};
