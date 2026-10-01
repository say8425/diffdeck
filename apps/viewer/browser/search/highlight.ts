export interface MatchRange {
	start: number;
	length: number;
}

// Shared by searchIndex.ts (counting) and highlightDom.ts (painting) so both
// agree on what a match is.
export const findRanges = (text: string, query: string): MatchRange[] => {
	if (query === "") return [];
	const haystack = text.toLowerCase();
	const needle = query.toLowerCase();
	const ranges: MatchRange[] = [];
	let from = 0;
	for (;;) {
		const idx = haystack.indexOf(needle, from);
		if (idx === -1) break;
		ranges.push({ start: idx, length: needle.length });
		from = idx + needle.length;
	}
	return ranges;
};
