import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "bun";
import packageJson from "../package.json";
import { type CwdDeps, isCwdAlive } from "./cwd.ts";
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
import { getRefs, type RefsResult } from "./refs.ts";
import { parseSelection, selectionCacheKey } from "./selection.ts";
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
//
// 반드시 모듈 스코프에 남아야 한다(diffCache와 달리 createHandler 안으로
// 옮기지 말 것) — diff-server.test.ts의 "answers a real diffFlight timeout
// (not baseFlight)" 테스트가 여기 의존한다: 그 테스트는 기본 타임아웃
// 서버로 이 repo를 먼저 데운 뒤, *별도로 새로 띄운* flightTimeoutMs:1
// 서버가 그 warm 항목을 그대로 봐야만 baseFlight가 1ms 레이스를 이기고
// diffFlight까지 진입한다. baseCache를 createHandler 스코프로 옮기면(구조적
// 격리를 위한 향후 정리로 그럴듯해 보일 수 있다) 두 번째 서버는 빈 캐시로
// 시작해 baseFlight가 miss로 되돌아가고 그 테스트는 조용히 baseFlight
// 가드만 다시 증명하게 된다 — 첫 번째 테스트와 똑같은 것을, 티 나지 않게.
const BASE_TTL_MS = 10_000;
// 피커 목록의 수명. 브랜치·워크트리는 diff 내용보다 훨씬 덜 움직이므로
// 짧게 잡아도 팝오버를 열 때마다 git을 두 번 부르지 않는다.
const REFS_TTL_MS = 5_000;
const baseCache = new Map<
	string,
	{ value: { base: string | null; ref: string | null }; at: number }
>();

// 플라이트가 타임아웃되면(= fn()이 settle하지 않았다는 신호, singleFlight.ts
// 참고) 요청을 무기한 매달아 두는 대신 503을 돌려준다. 짧은 Retry-After를
// 실어, 재시도가 "아직 매달려 있는 그 요청"이 아니라 새 요청임을 클라이언트가
// 신뢰하고 곧바로 다시 시도하게 한다 — 타임아웃이 곧 그 키를 이미 비웠으므로
// (createSingleFlight의 `.finally()`) 다음 호출은 새 플라이트로 시작한다.
// 브라우저 fetch()는 Retry-After를 자동으로 지키지 않으므로 browser/main.ts의
// fetchDiff가 직접 지연을 걸어야 한다 — 이 값(1초)과 그쪽의 재시도 지연
// (RETRY_DELAYS_MS, 1000ms)을 의도적으로 같은 수로 맞춰 둔다.
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

// 실제 syscall 바인딩. cwd.ts를 순수하게 유지하려고 밖에 둔다 —
// 단위 테스트는 isCwdAlive에 fake를 직접 주입한다.
const REAL_CWD_DEPS = { cwd: () => process.cwd(), exists: existsSync };

const createHandler = (cfg: {
	viewerDir: string;
	token: string;
	// 테스트 전용 훅 — 프로덕션(startDiffServer의 공개 CLI 표면)에서는 항상
	// undefined라 두 createSingleFlight 호출 모두 singleFlight.ts의
	// DEFAULT_TIMEOUT_MS를 쓴다. diff-server.test.ts가 이 값을 몇 ms로 줄여
	// 실제 git 서브프로세스 왕복보다 짧게 만들면, 손으로 만든 에러가 아니라
	// awaitFlight까지 이어지는 진짜 타임아웃이 실제 HTTP 503으로 나오는지
	// 검증할 수 있다.
	flightTimeoutMs?: number;
	// 프로세스 cwd가 삭제된 상태로 발견되면 부를 복구 함수. cli.ts가
	// toSafeCwd를 넘긴다. process.chdir()은 프로세스 전역 부작용이라
	// 라이브러리인 여기서 직접 부르지 않는다 — startDiffServer를 임베드한
	// 호스트의 cwd를 말없이 옮기게 되기 때문. 감지는 여기서, 복구 권한은
	// 프로세스를 소유한 쪽에서.
	repairCwd?: () => void;
	// 테스트 전용 훅 — 프로덕션에서는 항상 undefined라 REAL_CWD_DEPS를 쓴다.
	// flightTimeoutMs와 같은 패턴이다.
	cwdDeps?: CwdDeps;
}) => {
	const viewerRoot = resolve(cfg.viewerDir);
	const diffCache = createPayloadCache();
	// 동시 콜드 요청(프리워밍 + 첫 화면 + 폴)이 gh pr view를 중복 실행하지
	// 않게 single-flight로 합류시킨다. diffFlight와 마찬가지로 핸들러
	// 인스턴스마다 새로 만든다 — flightTimeoutMs를 인스턴스별로 다르게 줄
	// 수 있어야 하기 때문(테스트에서만 쓰임, 위 주석 참고).
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
	// 같은 (repo, untracked, mode)의 지문 계산+파이프라인을 동시에 한 번만 —
	// 콜드 상태에서 프리워밍과 첫 화면 요청이 겹쳐도 중복 실행되지 않는다.
	const diffFlight = createSingleFlight<PayloadCacheEntry>(cfg.flightTimeoutMs);
	// 피커 목록. baseCache와 달리 **핸들러 스코프**에 둔다 — baseCache가 모듈
	// 스코프인 것은 flight 타임아웃 테스트 둘이 "따로 띄운 두 서버가 같은 warm
	// 항목을 본다"에 의존하는 특수 사정 때문이고(CLAUDE.md), 여기엔 그런 요구가
	// 없다. 서버 인스턴스가 자기 캐시를 갖는 쪽이 격리에 낫다.
	const refsFlight = createSingleFlight<RefsResult>(cfg.flightTimeoutMs);
	const refsCache = new Map<string, { value: RefsResult; at: number }>();
	const getRefsCached = (repo: string): Promise<RefsResult> =>
		refsFlight(repo, async () => {
			const now = Date.now();
			const hit = refsCache.get(repo);
			if (hit && now - hit.at < REFS_TTL_MS) return hit.value;
			const value = await getRefs(repo);
			refsCache.set(repo, { value, at: now });
			return value;
		});
	return async (req: Request): Promise<Response> => {
		const url = new URL(req.url);

		// 예방(cli.ts의 toSafeCwd)이 어떤 이유로든 적용되지 않은 프로세스를
		// 위한 자가회복. cwd가 삭제되면 git 호출이 repo와 무관하게 전부
		// 죽으므로(자식 프로세스 생성 자체가 불가) 요청을 처리하기 전에
		// 되살린다. 라우트마다 흩지 않고 진입부에 두는 이유는 git을 쓰는
		// 라우트가 앞으로 늘어도 자동으로 덮이기 때문이고, repairCwd가 주입된
		// 경우 비용이 요청당 ~1µs(실측)라 그래도 되기 때문이다.
		//
		// `cfg.repairCwd &&`를 먼저 보는 게 계약이다 — repairCwd가 없으면
		// isCwdAlive 호출 자체를 건너뛴다. startDiffServer를 임베드했지만
		// repairCwd를 안 넘긴 호스트에게는 그 감지조차 원하지 않는 순수
		// 비용(위 ~1µs가 아니라 0이어야 하는 비용)이기 때문이다. 순서를
		// `if (!isCwdAlive(...)) cfg.repairCwd?.();`로 "정리"하면 매 요청 감지가
		// 다시 켜져 diff-server.test.ts의 "repairCwd를 안 넘기면 cwd 탐지
		// 자체를 건너뛴다" 테스트가 빨간불이 된다.
		if (cfg.repairCwd && !isCwdAlive(cfg.cwdDeps ?? REAL_CWD_DEPS)) {
			cfg.repairCwd();
		}

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
			const sel = parseSelection(url.searchParams);
			const repo = sel.repo;
			if (!repo || !(await isGitRepo(repo))) {
				return new Response("not a git repository", { status: 400 });
			}
			const untracked = sel.untracked;
			const mode = sel.base.kind === "auto" ? "base" : "working";
			const baseResult = await awaitFlight(resolveBaseCached(repo));
			if (baseResult instanceof Response) return baseResult;
			const { base, ref } = baseResult;
			// 파이프라인(파일당 git 서브프로세스) 전에 싼 지문으로 변경 여부를
			// 판정한다. 지문은 파이프라인 "이전"에 뜨므로, 그 사이에 리포가
			// 바뀌면 저장된 지문이 이미 낡은 값이 되어 다음 요청이 무조건
			// 재계산한다 — 낡은 payload가 눌러앉는 방향의 레이스는 없다.
			const cacheKey = selectionCacheKey(sel, ref);
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

		// 피커가 고를 수 있는 것들. /api/diff의 순차 flight 사슬에 끼우지 않고
		// 자기 라우트에서 자기 예산으로 돈다.
		if (url.pathname === "/api/refs") {
			if (url.searchParams.get("token") !== cfg.token) {
				return new Response("forbidden", { status: 403 });
			}
			const sel = parseSelection(url.searchParams);
			const repo = sel.repo;
			if (!repo || !(await isGitRepo(repo))) {
				return new Response("not a git repository", { status: 400 });
			}
			const result = await awaitFlight(getRefsCached(repo));
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
			if (!repo || !(await isGitRepo(repo))) {
				return new Response("not a git repository", { status: 400 });
			}
			const path = url.searchParams.get("path") ?? "";
			// blob은 이미지 diff 전용 — 이미지 외 파일(빈 경로 포함)은 노출하지 않는다.
			if (!isImagePath(path)) {
				return new Response("not found", { status: 404 });
			}
			const side = url.searchParams.get("side") === "old" ? "old" : "new";
			const mode = sel.base.kind === "auto" ? "base" : "working";
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
	// 테스트 전용 — CLI(cli.ts/args.ts)에는 배선돼 있지 않다. createHandler의
	// 같은 이름 필드로 그대로 흘러간다.
	flightTimeoutMs?: number;
	// 셋 중 유일하게 프로덕션에서 실제로 배선되는 필드 — cli.ts가 toSafeCwd를
	// 넘긴다. 위아래가 테스트 전용 훅이라고 이 필드까지 그렇게 읽지 말 것.
	repairCwd?: () => void;
	// 테스트 전용 훅 — 프로덕션에서는 항상 undefined라 REAL_CWD_DEPS를 쓴다.
	// flightTimeoutMs와 같은 패턴이다.
	cwdDeps?: CwdDeps;
}): DiffServerHandle => {
	const env = opts.env ?? process.env;
	// Mint the token but don't write it yet — Bun.serve throws if the port is
	// taken, and a token on disk is what tells a client a daemon is usable
	// here. Writing first would leave one pointing at whoever owns the port
	// (which rejects it), so bind first and only then publish.
	const existing = readTokenSync(env);
	const token = existing ?? generateToken();
	const handler = createHandler({
		viewerDir: opts.viewerDir,
		token,
		flightTimeoutMs: opts.flightTimeoutMs,
		repairCwd: opts.repairCwd,
		cwdDeps: opts.cwdDeps,
	});
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: opts.port,
		// Bun.serve 기본 idleTimeout(10초)은 콜드스타트 자원 경합(브라우저 기동
		// + prewarm git 서브프로세스 버스트)으로 첫 diff 응답이 10초를 넘는 순간
		// 커넥션을 강제 종료한다("request timed out after 10 seconds"). 120초는
		// /api/diff가 순차로 기다리는 두 플라이트(baseFlight → diffFlight)의
		// 합(singleFlight.ts의 기본 타임아웃 45초 × 2 = 90초)이 실제로 응답을
		// (정상이든 503이든) 만들어 낼 시간을 확보하고서도 isGitRepo·응답 전송에
		// ~30초 여유를 남기도록 고른 값이다 — 개별 플라이트가 아니라 "그 요청이
		// 기다리는 플라이트의 합 < idleTimeout"이 진짜 불변식이다. 예전엔 fn()이
		// settle하지 않을 때 이 값에 걸려도 클라이언트가 재시도하지 않아 뷰어가
		// "Loading…"에 영구 고착됐다 — 지금은 singleFlight 타임아웃이 503으로
		// 응답을 만들고, browser/main.ts의 fetchDiff가 그 503과 네트워크 실패를
		// 재시도해 자가 치유한다.
		idleTimeout: 120,
		fetch: handler,
	});
	if (existing == null) persistToken(token, env);
	const stop = (): void => {
		void server.stop(true);
	};
	return { server, token, stop };
};
