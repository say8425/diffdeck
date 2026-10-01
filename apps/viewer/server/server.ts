import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "bun";
import packageJson from "../package.json";
import { type BlobCache, createBlobCache } from "./blobCache.ts";
import { type CwdDeps, isCwdAlive } from "./cwd.ts";
import {
	getDiffFiles,
	getFileBytes,
	resolveBaseRef,
	verifyBaseRef,
} from "./diff.ts";
import { repoFingerprint } from "./fingerprint.ts";
import { imageContentType, isImagePath } from "./imageTypes.ts";
import {
	createPayloadCache,
	type PayloadCacheEntry,
	payloadEtag,
} from "./payloadCache.ts";
import { getPrs, type PrsByBranch } from "./prs.ts";
import { getRefs, type RefsResult } from "./refs.ts";
import { classifyRepo, repoProblemResponse } from "./repoCheck.ts";
import {
	parseSelection,
	type Selection,
	selectionCacheKey,
} from "./selection.ts";
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

const BASE_TTL_MS = 10_000;
const REFS_TTL_MS = 5_000;
const PRS_TTL_MS = 60_000;
// 실패는 짧게 캐시한다: 길면 기동 순간의 끊김 한 번이 PR 표시를 오래 지우고,
// 없으면 `gh`가 없는 환경에서 폴마다 스폰이 실패한다.
const PRS_FAILURE_TTL_MS = 10_000;
// base 해석(`gh pr view`)은 느려서 repo별로 캐시한다. 모듈 스코프에 둔다 —
// diff-server.test.ts의 diffFlight 타임아웃 테스트는 다른 서버가 데운 항목을 봐야
// diffFlight까지 간다. 옮기면 실패 없이 다른 가드만 증명한다(.claude/rules/server.md).
const baseCache = new Map<
	string,
	{ value: { base: string | null; ref: string | null }; at: number }
>();

// fetch는 Retry-After를 저절로 지키지 않는다 — browser/main.ts의 RETRY_DELAYS_MS와
// 같은 값으로 맞춰 둔다.
const FLIGHT_TIMEOUT_RETRY_AFTER_SECONDS = 1;

const flightTimeoutResponse = (): Response =>
	new Response("diff pipeline busy, retry shortly", {
		status: 503,
		headers: { "retry-after": String(FLIGHT_TIMEOUT_RETRY_AFTER_SECONDS) },
	});

/**
 * 타임아웃만 503으로 바꾸고 다른 에러는 다시 던진다. singleFlight의 키 해제·브라우저
 * 재시도와 함께여야 매달린 flight에서 회복한다(.claude/rules/server.md).
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

const REAL_CWD_DEPS = { cwd: () => process.cwd(), exists: existsSync };

const createHandler = (cfg: {
	viewerDir: string;
	token: string;
	// 여기부터 repairCwd 말고는 테스트 전용 훅이다(프로덕션에서는 undefined).
	flightTimeoutMs?: number;
	// cwd가 삭제됐을 때 부를 복구(cli.ts가 toSafeCwd를 넘긴다). chdir은 프로세스
	// 전역 부작용이라 라이브러리인 여기서 직접 하지 않는다.
	repairCwd?: () => void;
	cwdDeps?: CwdDeps;
	blobCache?: BlobCache;
	listPrs?: (repo: string) => Promise<PrsByBranch | null>;
}) => {
	const viewerRoot = resolve(cfg.viewerDir);
	const diffCache = createPayloadCache();
	const blobs = cfg.blobCache ?? createBlobCache();
	// flight는 핸들러마다 만든다 — 테스트가 서버마다 다른 flightTimeoutMs를 준다.
	const baseFlight = createSingleFlight<{
		base: string | null;
		ref: string | null;
	}>(cfg.flightTimeoutMs);
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
	const diffFlight = createSingleFlight<PayloadCacheEntry>(cfg.flightTimeoutMs);
	const refsFlight = createSingleFlight<RefsResult>(cfg.flightTimeoutMs);
	const refsCache = new Map<string, { value: RefsResult; at: number }>();
	// /api/diff·/api/blob·/api/summary가 같은 base를 보도록 여기서만 해석한다.
	// 사용자가 고른 ref가 존재하지 않으면 auto로 흘리지 않고 400이다 — 고르지 않은
	// 기준의 diff가 에러보다 나쁘다.
	const resolveSelectionBase = async (
		repo: string,
		sel: Selection,
	): Promise<{ base: string | null; ref: string | null } | Response> => {
		if (sel.base.kind === "ref") {
			const verified = await verifyBaseRef(repo, sel.base.ref);
			// 클라이언트는 이 표식이 있을 때만 저장된 base를 버린다.
			return (
				verified ??
				new Response(`unknown base ref: ${sel.base.ref}`, {
					status: 400,
					headers: { "x-diff-error": "unknown-base" },
				})
			);
		}
		return awaitFlight(resolveBaseCached(repo));
	};

	/**
	 * head도 base와 같은 보안 경계(`verifyBaseRef`)를 탄다 — `git diff`의 인자로 간다.
	 * 표식을 base와 가르는 것은 복구가 달라서다: base는 저장값을 버리면 되고, head는
	 * 링크가 고른 것이라 사용자가 되돌려야 한다.
	 */
	const resolveSelectionHead = async (
		repo: string,
		sel: Selection,
	): Promise<{ head: string | undefined } | Response> => {
		if (sel.head.kind !== "ref") return { head: undefined };
		const verified = await verifyBaseRef(repo, sel.head.ref);
		return verified
			? { head: verified.ref }
			: new Response(`unknown head ref: ${sel.head.ref}`, {
					status: 400,
					headers: { "x-diff-error": "unknown-head" },
				});
	};
	const getRefsCached = (repo: string): Promise<RefsResult> =>
		refsFlight(repo, async () => {
			const now = Date.now();
			const hit = refsCache.get(repo);
			if (hit && now - hit.at < REFS_TTL_MS) return hit.value;
			const value = await getRefs(repo);
			refsCache.set(repo, { value, at: now });
			return value;
		});
	const prsFlight = createSingleFlight<PrsByBranch>(cfg.flightTimeoutMs);
	const prsCache = new Map<
		string,
		{ value: PrsByBranch; at: number; ttl: number }
	>();
	const listPrs = cfg.listPrs ?? ((repo: string) => getPrs(repo));
	const getPrsCached = (repo: string): Promise<PrsByBranch> =>
		prsFlight(repo, async () => {
			const now = Date.now();
			const hit = prsCache.get(repo);
			if (hit && now - hit.at < hit.ttl) return hit.value;
			const got = await listPrs(repo);
			const value = got ?? {};
			const ttl = got === null ? PRS_FAILURE_TTL_MS : PRS_TTL_MS;
			prsCache.set(repo, { value, at: now, ttl });
			return value;
		});
	return async (req: Request): Promise<Response> => {
		const url = new URL(req.url);

		// cli.ts의 예방(toSafeCwd)이 빠진 프로세스를 위한 자가회복: cwd가 삭제되면 git
		// 호출이 repo와 무관하게 전부 죽는다. `cfg.repairCwd &&`를 먼저 보는 것이
		// 계약이다 — 주입하지 않은 임베드 호스트에는 감지 비용도 없어야 한다.
		if (cfg.repairCwd && !isCwdAlive(cfg.cwdDeps ?? REAL_CWD_DEPS)) {
			cfg.repairCwd();
		}

		if (url.pathname === "/api/ping") {
			return new Response(null, {
				status: 204,
				headers: {
					// Stays a constant: older clients match on it exactly.
					"x-diffdeck": "1",
					// A detached daemon outlives the install that spawned it, so report
					// who answers and let a client replace a stale one. This route is
					// unauthenticated and any process can bind the port: a client must
					// confirm the responder holds the token (a request that would
					// otherwise 403) before trusting or signaling the pid.
					"x-diffdeck-version": packageJson.version,
					"x-diffdeck-pid": String(process.pid),
				},
			});
		}

		if (url.pathname === "/api/diff") {
			if (url.searchParams.get("token") !== cfg.token) {
				return new Response("forbidden", { status: 403 });
			}
			const sel = parseSelection(url.searchParams);
			const repo = sel.repo;
			const problem = await classifyRepo(repo);
			if (problem) return repoProblemResponse(problem);
			const untracked = sel.untracked;
			const mode = sel.base.kind === "head" ? "working" : "base";
			const baseResult = await resolveSelectionBase(repo, sel);
			if (baseResult instanceof Response) return baseResult;
			const { base, ref } = baseResult;
			const headResult = await resolveSelectionHead(repo, sel);
			if (headResult instanceof Response) return headResult;
			const { head } = headResult;
			// 지문은 빌드 전에 뜬다 — 그 사이 리포가 바뀌면 저장된 지문이 이미 낡아 다음
			// 요청이 다시 빌드한다(낡은 payload가 눌러앉지 않는다).
			const cacheKey = selectionCacheKey(sel, ref);
			const entryResult = await awaitFlight(
				diffFlight(cacheKey, async () => {
					const fingerprint = await repoFingerprint(repo, {
						untracked,
						mode,
						ref: mode === "base" ? (ref ?? undefined) : undefined,
						head,
					});
					const cached = diffCache.get(cacheKey, fingerprint);
					if (cached) return cached;
					const files =
						mode === "base"
							? await getDiffFiles(
									repo,
									{ untracked, mode: "base", ref: ref ?? undefined, head },
									blobs,
								)
							: await getDiffFiles(repo, { untracked, head }, blobs);
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
			// 304에도 싣는다 — 클라이언트는 응답마다 이 값으로 base 이름을 갈아 끼운다.
			if (req.headers.get("if-none-match") === etag) {
				return new Response(null, {
					status: 304,
					headers: { etag, "x-diff-base": encodeURIComponent(base ?? "") },
				});
			}
			// NOTE: intentionally no Access-Control-Allow-Origin — cross-origin pages must not read this.
			return new Response(entry.body, {
				headers: {
					"content-type": "application/json; charset=utf-8",
					"x-diff-base": encodeURIComponent(base ?? ""),
					etag,
				},
			});
		}

		if (url.pathname === "/api/summary") {
			if (url.searchParams.get("token") !== cfg.token) {
				return new Response("forbidden", { status: 403 });
			}
			const sel = parseSelection(url.searchParams);
			const repo = sel.repo;
			const problem = await classifyRepo(repo);
			if (problem) return repoProblemResponse(problem);
			// 카드가 diff와 다른 비교를 설명하지 않도록 diff와 같은 base·head 해석을 탄다.
			const baseResult = await resolveSelectionBase(repo, sel);
			if (baseResult instanceof Response) return baseResult;
			const { base, ref } = baseResult;
			const headResult = await resolveSelectionHead(repo, sel);
			if (headResult instanceof Response) return headResult;
			const summary = await getRepoSummary(repo, {
				base,
				ref,
				head: headResult.head,
			});
			return new Response(JSON.stringify(summary), {
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}

		if (url.pathname === "/api/refs") {
			if (url.searchParams.get("token") !== cfg.token) {
				return new Response("forbidden", { status: 403 });
			}
			const sel = parseSelection(url.searchParams);
			const repo = sel.repo;
			const problem = await classifyRepo(repo);
			if (problem) return repoProblemResponse(problem);
			const result = await awaitFlight(getRefsCached(repo));
			if (result instanceof Response) return result;
			return new Response(JSON.stringify(result), {
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}

		// /api/refs에 합치지 않는다 — refs는 폴마다 돌고 `gh`는 네트워크를 타서, 묶으면
		// 목록과 라벨이 `gh`의 속도로 떨어진다.
		if (url.pathname === "/api/prs") {
			if (url.searchParams.get("token") !== cfg.token) {
				return new Response("forbidden", { status: 403 });
			}
			const repo = parseSelection(url.searchParams).repo;
			const problem = await classifyRepo(repo);
			if (problem) return repoProblemResponse(problem);
			const result = await awaitFlight(getPrsCached(repo));
			if (result instanceof Response) return result;
			return new Response(JSON.stringify(result), {
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}

		if (url.pathname === "/api/blob") {
			if (url.searchParams.get("token") !== cfg.token) {
				return new Response("forbidden", { status: 403 });
			}
			const sel = parseSelection(url.searchParams);
			const repo = sel.repo;
			const problem = await classifyRepo(repo);
			if (problem) return repoProblemResponse(problem);
			const path = url.searchParams.get("path") ?? "";
			// blob은 이미지 diff 전용 — 이미지 외 파일(빈 경로 포함)은 노출하지 않는다.
			if (!isImagePath(path)) {
				return new Response("not found", { status: 404 });
			}
			const side = url.searchParams.get("side") === "old" ? "old" : "new";
			const mode = sel.base.kind === "head" ? "working" : "base";
			let ref: string | null = null;
			if (mode === "base") {
				const baseResult = await resolveSelectionBase(repo, sel);
				if (baseResult instanceof Response) return baseResult;
				ref = baseResult.ref;
			}
			const headResult = await resolveSelectionHead(repo, sel);
			if (headResult instanceof Response) return headResult;
			const bytes = await getFileBytes(repo, path, side, {
				...(mode === "base" && ref ? { mode, ref } : {}),
				...(headResult.head ? { head: headResult.head } : {}),
			});
			if (!bytes) return new Response("not found", { status: 404 });
			// no-store: 워킹트리 이미지는 저장마다 바뀐다(변경 감지는 blobVersion 캐시버스터의 몫).
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
		// no-store: the bundle changes on rebuild/upgrade; never run a stale cached copy.
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
	// 여기부터 repairCwd 말고는 테스트 전용 훅이다(createHandler로 그대로 간다).
	flightTimeoutMs?: number;
	// 프로덕션에서 배선되는 유일한 훅 — cli.ts가 toSafeCwd를 넘긴다.
	repairCwd?: () => void;
	cwdDeps?: CwdDeps;
	blobCache?: BlobCache;
	listPrs?: (repo: string) => Promise<PrsByBranch | null>;
}): DiffServerHandle => {
	const env = opts.env ?? process.env;
	// Persist the token only after binding: a token on disk tells clients a daemon is
	// usable here, and Bun.serve throws if the port is taken.
	const existing = readTokenSync(env);
	const token = existing ?? generateToken();
	const handler = createHandler({
		viewerDir: opts.viewerDir,
		token,
		flightTimeoutMs: opts.flightTimeoutMs,
		repairCwd: opts.repairCwd,
		cwdDeps: opts.cwdDeps,
		blobCache: opts.blobCache,
		listPrs: opts.listPrs,
	});
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: opts.port,
		// 기본값(10초)은 콜드스타트의 첫 diff를 끊는다. /api/diff가 순서대로 기다리는 두
		// flight 타임아웃의 합(singleFlight.ts)보다 커야 한다 — 작으면 503보다 소켓이 먼저 끊긴다.
		idleTimeout: 120,
		fetch: handler,
	});
	if (existing == null) persistToken(token, env);
	const stop = (): void => {
		void server.stop(true);
	};
	return { server, token, stop };
};
