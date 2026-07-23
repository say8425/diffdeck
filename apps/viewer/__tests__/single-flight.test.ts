import { describe, expect, test } from "bun:test";
import { createSingleFlight } from "../server/singleFlight.ts";

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
});
