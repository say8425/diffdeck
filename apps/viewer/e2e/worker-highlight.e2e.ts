// 파일이 가상화 윈도우에 "처음" 들어올 때 마운트 프레임이 얼면 안 된다.
//
// non-worker 경로에서는 마운트 프레임 안에서 파일 전체(양쪽)가 동기
// 토크나이즈된다(renderDiffWithHighlighter — 범위 무시, 문법 정합성 정책).
// 4천 줄 파일이면 수백 ms 프리징 — retokenize-cache.e2e.ts가 고친 "재진입"과
// 달리 이것은 "최초 진입" 비용이라 캐시 보존으로는 해결되지 않는다.
// 수정: 뷰어가 workerManager를 주입해 워커 경로를 켠다 — plain AST가 동기로
// 즉시 그려지고(토크나이즈 0) 색은 워커 완료 시 재렌더로 입혀진다.
//
// [설계 이탈 — team-lead 승인] 브리프 원안(전체 문서 스크롤 한 루프만으로
// 측정)은 RED가 나오지 않는다. 이유 둘:
// ① big.ts(4,000줄 × 전량 재작성 = 8,000줄 변경)는 largeFile.ts의
//    LARGE_FILE_LINE_THRESHOLD(1,500) 초과라 첫 등장부터 항상 collapsed로
//    마운트되고(Foundation 예외 2호 emptyWindow = zero-tokenize), 알파벳
//    정렬상 bulk-*.ts보다 앞이라(big < bulk) 스크롤을 시작하기도 전에 이미
//    오버스캔 안에 들어와 있다 — "비싼 첫 진입"이 스크롤 경로에 전혀 없다.
//    나머지 bulk-*.ts(200줄)는 bulk-0 진입 때 이미 문법이 warm돼서 개별 첫
//    진입이 150ms를 못 넘는다. 자매 태스크(perf/preserve-render-cache의
//    retokenize-cache.e2e.ts)가 겪은 것과 동일한 big.ts auto-collapse
//    이슈라, 같은 패턴으로 "헤더 클릭으로 펼치는 스텝"을 추가해 비싼
//    non-collapsed 첫 렌더를 측정 윈도우 안에 강제로 포함시킨다.
// ② 클릭과 스크롤을 같은 루프에 합치면, 클릭 직후에도 계속 진행되는
//    스크롤이 (collapsed 상태의 작은 높이 때문에) big.ts를 오버스캔 밖으로
//    밀어내 펼침 렌더가 완료되기 전에 recycle(언마운트)해버린다 — 진단으로
//    확인(클릭 다음 프레임부터 컨테이너를 못 찾음). 그래서 펼침 갭 측정은
//    스크롤 없이 별도 루프로 분리하고, 전체 문서 스크롤은 그 뒤 별도 루프로
//    다른 파일들의 첫 진입을 훑는다.
import { expect, launchViewer, test } from "./fixtures/app.ts";

// [진단 전용 — 머지 금지] worker-highlight flake 계측판. 원래 스펙과 같은 이름·자리에서
// 같은 조건을 만들고, 단언 대신 워커 메시지 흐름·long task·메인 스레드 응답·CPU
// 프로필·색 첫 적용 시각을 기록해 `DIAG {json}` 한 줄로 찍는다.
test("first entry into the overscan window must not freeze the frame", async ({
	page,
}, testInfo) => {
	test.setTimeout(150_000);
	await page.addInitScript(() => {
		const w = window as unknown as { __diag: Record<string, any> };
		const d = (w.__diag = {
			workers: 0, posted: 0, received: 0, errors: [] as string[],
			lastRecv: 0, lastPost: 0, longtasks: [] as number[][], firstColor: 0,
		});
		const Orig = window.Worker;
		window.Worker = class extends Orig {
			constructor(...a: ConstructorParameters<typeof Worker>) {
				super(...a);
				d.workers++;
				this.addEventListener("message", () => { d.received++; d.lastRecv = performance.now(); });
				this.addEventListener("error", (e) => d.errors.push(`error:${(e as ErrorEvent).message ?? e.type}`));
				this.addEventListener("messageerror", () => d.errors.push("messageerror"));
			}
			override postMessage(...a: Parameters<Worker["postMessage"]>) {
				d.posted++; d.lastPost = performance.now();
				// @ts-expect-error spread into overloads
				return super.postMessage(...a);
			}
		} as typeof Worker;
		new PerformanceObserver((l) => {
			for (const e of l.getEntries()) d.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]);
		}).observe({ type: "longtask", buffered: true });
		setInterval(() => {
			if (d.firstColor) return;
			for (const c of document.querySelectorAll("diffs-container")) {
				if (c.shadowRoot?.querySelector("pre")?.querySelector("span[style]")) { d.firstColor = Math.round(performance.now()); break; }
			}
		}, 250);
	});
	const snap = (): Promise<unknown> =>
		Promise.race([
			page.evaluate(() => {
				const d = (window as unknown as { __diag: Record<string, any> }).__diag;
				const sc = document.getElementById("diff");
				const now = performance.now();
				return {
					t: Math.round(now), vis: document.visibilityState, workers: d.workers,
					posted: d.posted, received: d.received,
					lastRecvAgo: d.lastRecv ? Math.round(now - d.lastRecv) : null,
					lastPostAgo: d.lastPost ? Math.round(now - d.lastPost) : null,
					errors: d.errors.slice(0, 5), longtasks: d.longtasks.length,
					ltSum: d.longtasks.reduce((a: number, x: number[]) => a + (x[1] ?? 0), 0),
					ltLast: d.longtasks.slice(-4), firstColor: d.firstColor,
					scrollTop: Math.round(sc?.scrollTop ?? -1), scrollH: sc?.scrollHeight,
					mounted: document.querySelectorAll("diffs-container").length,
				};
			}),
			new Promise((r) => setTimeout(() => r("NO_RESPONSE_1500MS"), 1500)),
		]);
	const viewer = await launchViewer([], { bulkFiles: 12, bigFileLines: 4000 });
	const cdp = await page.context().newCDPSession(page);
	const summary: Record<string, unknown> = { rep: testInfo.repeatEachIndex };
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, { timeout: 15_000 });
		await expect(page.locator("diffs-container").first()).toBeVisible();
		await page.mouse.move(2, 2);
		await page.waitForTimeout(2000);
		summary.beforePhase1 = await snap();
		const { expandGapMs, sawExpandedBig } = await page.evaluate(() => {
			const findBig = (): Element | undefined =>
				[...document.querySelectorAll("diffs-container")].find(
					(c) =>
						c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
						"src/big.ts",
				);
			return new Promise<{ expandGapMs: number; sawExpandedBig: boolean }>(
				(resolve) => {
					let maxGap = 0;
					let last = performance.now();
					let frames = 0;
					let clicked = false;
					let expanded = false;
					const tick = (): void => {
						const now = performance.now();
						maxGap = Math.max(maxGap, now - last);
						last = now;
						frames++;
						// CodeView.updateItem()은 render(immediate=false)를 통해 실제
						// 동기 렌더를 queueRender로 "다음 rAF"에 미룬다(engine의
						// UniversalRenderingManager) — 그래서 비싼 토크나이즈는 클릭
						// 자체가 아니라 클릭 다음 프레임에서 터진다. 이 루프가 클릭
						// *전부터* 이미 돌고 있어야 그 프레임의 갭을 잡을 수 있다 —
						// 순서를 바꿔 클릭 후에 루프를 시작하면 이 가드는 조용히
						// 무력화된다.
						if (frames === 2 && !clicked) {
							clicked = true;
							const header = findBig()?.shadowRoot?.querySelector(
								"[data-diffs-header]",
							);
							header?.dispatchEvent(
								new MouseEvent("click", { bubbles: true, composed: true }),
							);
						}
						if (clicked && !expanded) {
							const len =
								findBig()?.shadowRoot?.querySelector("pre")?.textContent
									?.length ?? 0;
							if (len > 1000) expanded = true;
						}
						if (frames < 30) {
							requestAnimationFrame(tick);
						} else {
							resolve({ expandGapMs: maxGap, sawExpandedBig: expanded });
						}
					};
					requestAnimationFrame(tick);
				},
			);
		});

		summary.phase1 = { expandGapMs: Math.round(expandGapMs), sawExpandedBig };
		summary.beforeScroll = await snap();
		const tracing = process.env.DIAG_TRACE === "1";
		const browser = tracing ? page.context().browser() : null;
		await browser?.startTracing(page, {
			categories: [
				"toplevel", "blink", "v8", "devtools.timeline", "cc", "gpu", "viz",
				"disabled-by-default-devtools.timeline", "loading", "renderer.scheduler",
			],
		});
		if (tracing) {
			await cdp.send("Profiler.enable");
			await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
			await cdp.send("Profiler.start");
		}
		let done = false;
		let scroll: unknown;
		const wheel = process.env.DIAG_WHEEL === "1";
		if (wheel) {
			// 휠 입력으로 스크롤한다 — 컴포지터 스레드가 처리하므로 JS의 scrollTop 대입이
			// 부르는 동기 커밋 대기(LayerTreeHost::WaitForCommitCompletion)를 거치지 않는다.
			await page.evaluate(() => {
				const w = window as unknown as { __gap: { max: number; frames: number; stop: boolean } };
				w.__gap = { max: 0, frames: 0, stop: false };
				let last = performance.now();
				const tick = (): void => {
					const now = performance.now();
					w.__gap.max = Math.max(w.__gap.max, now - last);
					last = now;
					w.__gap.frames++;
					if (!w.__gap.stop) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			});
			const box = await page.locator("#diff").boundingBox();
			if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			void (async () => {
				const t = Date.now();
				try {
					for (let i = 0; i < 240; i++) {
						await page.mouse.wheel(0, 900);
						await new Promise((r) => setTimeout(r, 16));
					}
					scroll = await page.evaluate(() => {
						const w = window as unknown as { __gap: { max: number; frames: number; stop: boolean } };
						w.__gap.stop = true;
						return { frames: w.__gap.frames, maxGap: Math.round(w.__gap.max), ms: 0, wheel: true };
					});
					(scroll as { ms: number }).ms = Date.now() - t;
				} catch (e) {
					scroll = `ERR ${String(e).slice(0, 200)}`;
				}
				done = true;
			})();
		} else void page
			.evaluate(
				() =>
					new Promise((resolve) => {
						const scroller = document.getElementById("diff") as HTMLElement;
						let last = performance.now();
						const t0 = last;
						let frames = 0;
						let maxGap = 0;
						const gaps: number[] = [];
						const tick = (): void => {
							const now = performance.now();
							const g = now - last;
							last = now;
							maxGap = Math.max(maxGap, g);
							gaps.push(Math.round(g));
							frames++;
							scroller.scrollTop += 900;
							if (frames < 240 && now - t0 < 100_000) requestAnimationFrame(tick);
							else resolve({ frames, maxGap: Math.round(maxGap), ms: Math.round(now - t0), gaps: gaps.filter((_, i) => i % 5 === 0) });
						};
						requestAnimationFrame(tick);
					}),
			)
			.then(
				(r) => { scroll = r; done = true; },
				(e) => { scroll = `ERR ${String(e).slice(0, 200)}`; done = true; },
			);
		const samples: unknown[] = [];
		const t0 = Date.now();
		let silent = 0;
		while (!done && Date.now() - t0 < 60_000 && silent < 10) {
			await new Promise((r) => setTimeout(r, 2000));
			const s = await snap();
			silent = s === "NO_RESPONSE_1500MS" ? silent + 1 : 0;
			samples.push([Math.round((Date.now() - t0) / 1000), s]);
		}
		const traceBuf = (await Promise.race([
			browser?.stopTracing(),
			new Promise((r) => setTimeout(() => r(null), 30_000)),
		])) as Buffer | null;
		if (traceBuf) {
			const raw = JSON.parse(traceBuf.toString("utf8"));
			const evs: any[] = Array.isArray(raw) ? raw : raw.traceEvents;
			const names = new Map<string, string>();
			for (const e of evs)
				if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args?.name);
			const thr = (e: any) => names.get(`${e.pid}:${e.tid}`) ?? `${e.pid}:${e.tid}`;
			const long = evs
				.filter((e) => e.ph === "X" && e.dur > 500_000)
				.map((e) => [thr(e), e.name, Math.round(e.dur / 1000), e.args?.data?.type ?? ""])
				.sort((a, b) => (b[2] as number) - (a[2] as number))
				.slice(0, 25);
			const open = new Map<string, any[]>();
			for (const e of [...evs].sort((a, b) => a.ts - b.ts)) {
				const k = `${e.pid}:${e.tid}`;
				if (e.ph === "B") (open.get(k) ?? open.set(k, []).get(k))!.push(e);
				else if (e.ph === "E") open.get(k)?.pop();
			}
			const unclosed: any[] = [];
			for (const [k, st] of open) {
				const n = names.get(k) ?? k;
				if (st.length && !/Perfetto/.test(n)) unclosed.push([n, st.map((e) => `${e.name}@${Math.round(e.ts / 1000)}`).join(" > ")]);
			}
			const tsMax = evs.reduce((m, e) => Math.max(m, e.ts ?? 0), 0);
			const lastByThread: any[] = [];
			for (const [k, n] of names) {
				if (!/CrRendererMain|Compositor|VizCompositor|CrGpuMain|DedicatedWorker/.test(n ?? "")) continue;
				const mine = evs.filter((e) => `${e.pid}:${e.tid}` === k && e.ts);
				const lastEv = mine.reduce((a, b) => (b.ts + (b.dur ?? 0) > (a?.ts ?? 0) + (a?.dur ?? 0) ? b : a), undefined as any);
				if (lastEv) lastByThread.push([n, lastEv.name, Math.round((tsMax - lastEv.ts - (lastEv.dur ?? 0)) / 1000)]);
			}
			summary.trace = { events: evs.length, long, unclosed: unclosed.slice(0, 20), lastByThread };
			await testInfo.attach("chrome-trace.json", { body: traceBuf, contentType: "application/json" });
		} else summary.trace = "STOP_TRACING_TIMEOUT";
		const prof = (await Promise.race([
			tracing ? cdp.send("Profiler.stop") : Promise.resolve(null),
			new Promise((r) => setTimeout(() => r(null), 10_000)),
		])) as { profile?: { nodes: any[]; samples: number[] } } | null;
		summary.scrollDone = done;
		summary.scroll = scroll;
		summary.samples = samples;
		summary.after = await snap();
		if (prof?.profile) {
			const byId = new Map(prof.profile.nodes.map((n: any) => [n.id, n]));
			const self = new Map<string, number>();
			for (const id of prof.profile.samples) {
				const cf = byId.get(id)?.callFrame;
				const key = `${cf?.functionName || "(anon)"} ${String(cf?.url ?? "").split("/").pop()}:${cf?.lineNumber}:${cf?.columnNumber}`;
				self.set(key, (self.get(key) ?? 0) + 1);
			}
			summary.profileTop = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
			summary.profileSamples = prof.profile.samples.length;
		} else summary.profileTop = "PROFILER_STOP_TIMEOUT";
		console.log(`DIAG ${JSON.stringify(summary)}`);
		await testInfo.attach("diag.json", {
			body: JSON.stringify({ summary, profile: prof?.profile ?? null }),
			contentType: "application/json",
		});
	} finally {
		await viewer.stop();
	}
});

test("viewer renders highlighted output even when the worker script fails to load", async ({
	page,
}) => {
	// 폴백: 워커 스크립트 로드가 실패하면(404/차단) 엔진은 이를 감지하지 못해
	// diff가 영구 공백이 된다 — main.ts의 앱 레벨 워치독(recoverFromWorkerLoadFailure)이
	// error 이벤트에서 풀을 종료하고 CodeView를 workerManager 없이 재구성해
	// non-worker 동기 경로로 복구한다. 워커 요청을 route로 차단해 그 복구를 검증한다.
	await page.route("**/worker.js", (route) => route.abort());
	const viewer = await launchViewer([]);
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		// 기본 픽스처의 hello.ts가 하이라이트되어 렌더된다 (span[style] 존재).
		await expect
			.poll(
				() =>
					page.evaluate(() =>
						[...document.querySelectorAll("diffs-container")].some(
							(c) =>
								(c.shadowRoot?.textContent ?? "").includes("hello, world") &&
								c.shadowRoot
									?.querySelector("pre")
									?.querySelector("span[style]") != null,
						),
					),
				{ timeout: 20_000 },
			)
			.toBe(true);
	} finally {
		await viewer.stop();
	}
});
