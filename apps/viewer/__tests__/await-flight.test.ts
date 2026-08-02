import { describe, expect, test } from "bun:test";
import { awaitFlight } from "../server/server.ts";
import { SingleFlightTimeoutError } from "../server/singleFlight.ts";

// awaitFlight는 singleFlight 호출의 실패를 503 Response로 흡수할지 그대로
// 다시 던질지 가르는 유일한 지점이다. HTTP 레벨(diff-server.test.ts)에서는
// baseFlight/diffFlight가 고정 30초 타임아웃이라 실제로 타임아웃시킬 수
// 없으므로, 여기서 직접 단위 테스트한다.
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
});
