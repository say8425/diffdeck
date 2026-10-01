import { describe, expect, test } from "bun:test";
import { awaitFlight } from "../server/server.ts";
import {
	createSingleFlight,
	SingleFlightTimeoutError,
} from "../server/singleFlight.ts";

const neverSettles = (): Promise<never> => new Promise(() => {});

describe("awaitFlight", () => {
	test("resolves to the value when the promise settles normally", async () => {
		const result = await awaitFlight(Promise.resolve({ ok: true }));
		expect(result).toEqual({ ok: true });
	});

	test("maps a SingleFlightTimeoutError to a 503 with Retry-After", async () => {
		const result = await awaitFlight(
			Promise.reject(new SingleFlightTimeoutError("k", 30_000)),
		);
		expect(result).toBeInstanceOf(Response);
		const res = result as Response;
		expect(res.status).toBe(503);
		expect(res.headers.get("retry-after")).toBe("1");
		expect(await res.text()).toBe("diff pipeline busy, retry shortly");
	});

	test("rethrows an ordinary error unchanged", async () => {
		const boom = new Error("boom");
		try {
			await awaitFlight(Promise.reject(boom));
			throw new Error("expected awaitFlight to reject, but it resolved");
		} catch (err) {
			expect(err).toBe(boom);
		}
	});

	// 손으로 만든 에러만으로는 진짜 singleFlight 타임아웃이 instanceof 검사를 통과한다는 것이 증명되지 않는다.
	test("a real single-flight timeout becomes a 503 through awaitFlight", async () => {
		const flight = createSingleFlight<string>(5);
		const result = await awaitFlight(flight("k", neverSettles));
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(503);
	});
});
