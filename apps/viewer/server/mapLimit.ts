/** 동시 실행 수를 묶은 map. 결과는 입력 순서이고, 하나라도 실패하면 reject한다. */
export const mapWithLimit = async <T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
	const results: R[] = [];
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const index = next;
			next += 1;
			// 워커별 순차 실행이 동시성 제한이다.
			// oxlint-disable-next-line no-await-in-loop
			results[index] = await fn(items[index], index);
		}
	};
	const workers = Array.from(
		{ length: Math.max(1, Math.min(limit, items.length)) },
		() => worker(),
	);
	await Promise.all(workers);
	return results;
};
