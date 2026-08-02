/**
 * 같은 키의 비동기 작업이 동시에 요청되면 한 번만 실행하고 결과를 공유한다.
 * 콜드 상태에서 프리워밍·첫 화면·watch 폴이 겹쳐도 diff 파이프라인(파일당
 * git 서브프로세스)과 base 해석(gh pr view)이 중복 실행되지 않게 한다.
 *
 * fn()이 settle하지 않는 경로가 실측됐다 — Bun 1.3.12의 `$`(ShellPromise)가,
 * diff.ts의 BUILD_CONCURRENCY=8 git 서브프로세스 버스트가 외부 프로세스 생성
 * 경합과 겹치면 resolve도 reject도 없이 영구히 pending 상태가 된다(자식은
 * 시스템에서 사라지고 좀비도 없고 이벤트 루프도 정상인데 프라미스만 안
 * 끝난다). ShellPromise엔 `.timeout()`/`.kill()`이 없어 Promise.race가 유일한
 * 레버다. 타임아웃이 뜨면 이 슬롯을 reject해 `.finally()`가 키를 지우게
 * 하고, 그래야 "다음" 호출이 죽은 프라미스에 합류하지 않고 새로 시작한다 —
 * 버려진 원래 fn()은 백그라운드에서 계속 pending인 채로 남지만 더는 아무도
 * 기다리지 않는다.
 */

export type SingleFlight<T> = (key: string, fn: () => Promise<T>) => Promise<T>;

/** fn()이 아니라 타임아웃이 이겼음을 호출자가 구분할 수 있게 하는 표식. */
export class SingleFlightTimeoutError extends Error {
	constructor(key: string, timeoutMs: number) {
		super(`single-flight timed out after ${timeoutMs}ms (key: ${key})`);
		this.name = "SingleFlightTimeoutError";
	}
}

// 30초: Bun.serve의 idleTimeout(60초, server.ts)보다 반드시 낮아야 한다 —
// 안 그러면 타임아웃이 응답을 만들기도 전에 커넥션이 먼저 끊긴다. 동시에
// 콜드스타트 정상 작업(server.ts의 관측 기록상 첫 diff 응답이 10초를 넘긴
// 사례 있음)보다는 충분히 여유 있어야 정상 응답을 오탐으로 취소하지 않는다.
const DEFAULT_TIMEOUT_MS = 30_000;

export const createSingleFlight = <T>(
	timeoutMs = DEFAULT_TIMEOUT_MS,
): SingleFlight<T> => {
	const inFlight = new Map<string, Promise<T>>();
	return (key, fn) => {
		const existing = inFlight.get(key);
		if (existing) return existing;
		// fn()을 타이머 구성보다 먼저 평가한다 — fn()이 동기적으로 throw하면(현재
		// 호출자는 전부 async라 미도달이지만) 그 예외가 타이머를 아예 만들기
		// 전에 이 함수 밖으로 그대로 전파돼, 원래 구현(`fn().finally(...)`)과
		// 동일하게 동작하고 타이머가 무주공산으로 남지 않는다.
		const work = fn();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				reject(new SingleFlightTimeoutError(key, timeoutMs));
			}, timeoutMs);
		});
		const flight = Promise.race([work, timeout]).finally(() => {
			clearTimeout(timer);
			inFlight.delete(key);
		});
		inFlight.set(key, flight);
		return flight;
	};
};
