/**
 * 같은 키의 동시 작업을 한 번만 돌리고 결과를 공유한다. flight는 타임아웃과
 * race해 fn()이 settle하지 않아도 키를 푼다 — 안 풀면 이후 호출이 죽은 프라미스에
 * 합류한다. ShellPromise에는 `.timeout()`/`.kill()`이 없다(server.md).
 */

export type SingleFlight<T> = (key: string, fn: () => Promise<T>) => Promise<T>;

/** fn()이 아니라 타임아웃이 이겼음을 호출자가 구분할 수 있게 하는 표식. */
export class SingleFlightTimeoutError extends Error {
	constructor(key: string, timeoutMs: number) {
		super(`single-flight timed out after ${timeoutMs}ms (key: ${key})`);
		this.name = "SingleFlightTimeoutError";
	}
}

// 제약은 합이다: /api/diff는 baseFlight → diffFlight를 순서대로 기다리므로 이 값의
// 2배가 Bun.serve의 idleTimeout(server.ts)보다 작아야 한다. 콜드스타트의 정상 작업을
// 끊지 않을 만큼은 길어야 한다.
const DEFAULT_TIMEOUT_MS = 45_000;

export const createSingleFlight = <T>(
	timeoutMs = DEFAULT_TIMEOUT_MS,
): SingleFlight<T> => {
	const inFlight = new Map<string, Promise<T>>();
	return (key, fn) => {
		const existing = inFlight.get(key);
		if (existing) return existing;
		// fn()을 타이머보다 먼저 부른다 — 동기 throw 때 타이머가 남지 않게.
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
