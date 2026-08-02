import { describe, expect, test } from "bun:test";
import { awaitFlight } from "../server/server.ts";
import {
	createSingleFlight,
	SingleFlightTimeoutError,
} from "../server/singleFlight.ts";

// awaitFlight는 singleFlight 호출의 실패를 503 Response로 흡수할지 그대로
// 다시 던질지 가르는 유일한 지점이다. HTTP 레벨(diff-server.test.ts)에서는
// baseFlight/diffFlight가 고정 30초 타임아웃이라 실제로 타임아웃시킬 수
// 없으므로, 여기서 직접 단위 테스트한다.

// 절대 settle하지 않는 fn() — 아무 것도 캡처하지 않으므로 모듈 스코프에 둔다
// (oxlint unicorn/consistent-function-scoping; single-flight.test.ts와 동일 관례).
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

	// 위 두 테스트는 각자 절반만 증명한다 — single-flight.test.ts는 진짜
	// 타임아웃이 SingleFlightTimeoutError를 낳는다는 것을, 위 "maps a
	// SingleFlightTimeoutError..." 테스트는 손으로 만든 그 에러를 awaitFlight가
	// 503으로 바꾼다는 것을. 이 테스트가 그 둘을 실제로 이어 붙여, 진짜
	// createSingleFlight 타임아웃이 awaitFlight의 instanceof 체크를 실제로
	// 통과하는지(추론이 아니라) 확인한다.
	test("a real single-flight timeout becomes a 503 through awaitFlight", async () => {
		const flight = createSingleFlight<string>(5);
		const result = await awaitFlight(flight("k", neverSettles));
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(503);
	});
});
