import { describe, expect, test } from "bun:test";
import {
	createSingleFlight,
	SingleFlightTimeoutError,
} from "../server/singleFlight.ts";

// bun-types@1.3.14의 `expect(p).rejects.toThrow(...)` 타입 선언이 실제로는
// Promise를 반환하는 체인을 sync `void`로 선언해 둬서(MatchersBuiltin.rejects:
// Matchers<unknown>, toThrow(): void — 둘 다 Promise가 아님), await하면
// oxlint-tsgolint의 type-aware await-thenable이 오탐한다(런타임은 정상,
// 타입만 어긋남). `.rejects` sugar 대신 명시적 try/catch로 우회한다.
const rejectionOf = async (p: Promise<unknown>): Promise<Error> => {
	try {
		await p;
	} catch (e) {
		return e as Error;
	}
	throw new Error("expected promise to reject, but it resolved");
};

const deferred = <T>(): {
	promise: Promise<T>;
	resolve: (v: T) => void;
	reject: (e: unknown) => void;
} => {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

// 절대 settle하지 않는 fn() — 아무 것도 캡처하지 않으므로 모듈 스코프에 둔다
// (oxlint unicorn/consistent-function-scoping).
const neverSettles = (): Promise<never> => new Promise(() => {});

describe("createSingleFlight", () => {
	test("concurrent calls with the same key share one execution", async () => {
		const flight = createSingleFlight<string>();
		let calls = 0;
		const gate = deferred<string>();
		const fn = (): Promise<string> => {
			calls++;
			return gate.promise;
		};
		const p1 = flight("k", fn);
		const p2 = flight("k", fn);
		gate.resolve("done");
		expect(await p1).toBe("done");
		expect(await p2).toBe("done");
		expect(calls).toBe(1);
	});

	test("different keys run independently", async () => {
		const flight = createSingleFlight<string>();
		let calls = 0;
		const fn = (): Promise<string> => {
			calls++;
			return Promise.resolve(`r${calls}`);
		};
		const [a, b] = await Promise.all([flight("a", fn), flight("b", fn)]);
		expect(calls).toBe(2);
		expect(a).not.toBe(b);
	});

	test("after settling, the next call executes again", async () => {
		const flight = createSingleFlight<number>();
		let calls = 0;
		const fn = (): Promise<number> => Promise.resolve(++calls);
		expect(await flight("k", fn)).toBe(1);
		expect(await flight("k", fn)).toBe(2);
	});

	test("a rejection reaches every waiter and clears the slot for retry", async () => {
		const flight = createSingleFlight<string>();
		let calls = 0;
		const gate = deferred<string>();
		const failing = (): Promise<string> => {
			calls++;
			return gate.promise;
		};
		const p1 = flight("k", failing);
		const p2 = flight("k", failing);
		gate.reject(new Error("boom"));
		expect((await rejectionOf(p1)).message).toBe("boom");
		expect((await rejectionOf(p2)).message).toBe("boom");
		expect(calls).toBe(1);
		// 실패가 눌러앉지 않는다 — 다음 호출은 새로 실행된다.
		expect(await flight("k", () => Promise.resolve("recovered"))).toBe(
			"recovered",
		);
	});

	// fake timer는 이 리포에서 이미 한 번 물었다(apps/viewer/__tests__/
	// copy-button.test.ts) — jest.useFakeTimers() 중 setTimeout을 flush하면
	// bun test 프로세스 전체가 행업한다. 타임아웃이 주입 가능하게 설계된 건
	// 정확히 이 함정을 피하기 위해서다: 실제 타이머 + 5ms짜리 타임아웃으로
	// 테스트를 실시간에 가깝게 끝낸다.
	test("a flight that never settles rejects with the timeout error and frees the key for the next call", async () => {
		const flight = createSingleFlight<string>(5);
		const err = await rejectionOf(flight("k", neverSettles));
		expect(err).toBeInstanceOf(SingleFlightTimeoutError);
		expect(err.message).toBe("single-flight timed out after 5ms (key: k)");
		// 타임아웃이 .finally()를 통해 키를 비웠으므로, 다음 호출은 (여전히
		// pending인) 죽은 첫 fn()에 합류하지 않고 새 fn()으로 실행된다.
		expect(await flight("k", () => Promise.resolve("fresh"))).toBe("fresh");
	});

	test("different keys time out independently", async () => {
		const flight = createSingleFlight<string>(5);
		const [a, b] = await Promise.all([
			rejectionOf(flight("a", neverSettles)),
			rejectionOf(flight("b", neverSettles)),
		]);
		expect(a).toBeInstanceOf(SingleFlightTimeoutError);
		expect(b).toBeInstanceOf(SingleFlightTimeoutError);
	});

	// 타이머가 제대로 clearTimeout되지 않으면 dangling timer가 프로세스를 붙들어
	// bun test가(그리고 CLI가) 오래 살아있게 된다. 여기서 직접 "타이머가 없다"를
	// assert할 수는 없는 약한 검증이지만, 타임아웃(2초)이 이 테스트 자체의
	// 실행 시간보다 훨씬 길게 잡혀 있으므로 스위트가 그 2초를 기다리지 않고
	// 바로 끝난다는 사실 자체가(그리고 전체 스위트가 행업 없이 종료된다는
	// 사실이) 신호다.
	test("a flight that settles well before the timeout leaves no live timer behind", async () => {
		const flight = createSingleFlight<string>(2_000);
		expect(await flight("k", () => Promise.resolve("fast"))).toBe("fast");
	});

	test("the default timeout is used when none is provided", async () => {
		const flight = createSingleFlight<string>();
		expect(await flight("k", () => Promise.resolve("ok"))).toBe("ok");
	});
});
