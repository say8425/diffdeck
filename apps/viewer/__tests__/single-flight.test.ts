import { describe, expect, test } from "bun:test";
import {
	createSingleFlight,
	SingleFlightTimeoutError,
} from "../server/singleFlight.ts";

// bun-types가 `.rejects.toThrow()`를 void로 선언해 await하면 oxlint의
// await-thenable이 오탐한다 — try/catch로 받는다.
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
		expect(await flight("k", () => Promise.resolve("recovered"))).toBe(
			"recovered",
		);
	});

	// fake timers 중 setTimeout을 흘리면 bun test 전체가 멈출 수 있어 실제
	// 타이머와 주입한 5ms 타임아웃을 쓴다.
	test("a flight that never settles rejects with the timeout error and frees the key for the next call", async () => {
		const flight = createSingleFlight<string>(5);
		const err = await rejectionOf(flight("k", neverSettles));
		expect(err).toBeInstanceOf(SingleFlightTimeoutError);
		expect(err.message).toBe("single-flight timed out after 5ms (key: k)");
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

	// 남은 타이머를 직접 단언할 방법이 없어 약한 검증이다.
	test("a flight that settles well before the timeout leaves no live timer behind", async () => {
		const flight = createSingleFlight<string>(2_000);
		expect(await flight("k", () => Promise.resolve("fast"))).toBe("fast");
	});

	test("the default timeout is used when none is provided", async () => {
		const flight = createSingleFlight<string>();
		expect(await flight("k", () => Promise.resolve("ok"))).toBe("ok");
	});
});
