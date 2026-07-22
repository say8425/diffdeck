import { describe, expect, test } from "bun:test";
import { createSingleFlight } from "../server/singleFlight.ts";

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
		expect(p1).rejects.toThrow("boom");
		expect(p2).rejects.toThrow("boom");
		await Promise.allSettled([p1, p2]);
		expect(calls).toBe(1);
		// 실패가 눌러앉지 않는다 — 다음 호출은 새로 실행된다.
		expect(await flight("k", () => Promise.resolve("recovered"))).toBe(
			"recovered",
		);
	});
});
