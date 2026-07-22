/**
 * 같은 키의 비동기 작업이 동시에 요청되면 한 번만 실행하고 결과를 공유한다.
 * 콜드 상태에서 프리워밍·첫 화면·watch 폴이 겹쳐도 diff 파이프라인(파일당
 * git 서브프로세스)과 base 해석(gh pr view)이 중복 실행되지 않게 한다.
 */

export type SingleFlight<T> = (key: string, fn: () => Promise<T>) => Promise<T>;

export const createSingleFlight = <T>(): SingleFlight<T> => {
	const inFlight = new Map<string, Promise<T>>();
	return (key, fn) => {
		const existing = inFlight.get(key);
		if (existing) return existing;
		const flight = fn().finally(() => inFlight.delete(key));
		inFlight.set(key, flight);
		return flight;
	};
};
