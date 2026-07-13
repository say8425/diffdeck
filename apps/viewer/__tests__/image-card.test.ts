import "./happydom.ts";
import { describe, expect, mock, test } from "bun:test";
import { DIFFS_CHANGE_ICON_ATTR, DIFFS_HEADER_ATTR } from "@diffdeck/diffs";
import { ensureImageCard } from "../browser/imageCard.ts";
import type { ImageEntry } from "../browser/imageDiff.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

const makeContainer = (): {
	host: HTMLElement;
	root: ShadowRoot;
	header: HTMLElement;
	use: SVGUseElement;
} => {
	const host = document.createElement("div");
	const root = host.attachShadow({ mode: "open" });
	const header = document.createElement("div");
	header.setAttribute(DIFFS_HEADER_ATTR, "");
	const add = document.createElement("span");
	add.setAttribute("data-additions-count", "");
	const del = document.createElement("span");
	del.setAttribute("data-deletions-count", "");
	const icon = document.createElementNS(SVG_NS, "svg");
	icon.setAttribute(DIFFS_CHANGE_ICON_ATTR, "modified");
	const use = document.createElementNS(SVG_NS, "use") as SVGUseElement;
	use.setAttribute("href", "#diffs-icon-symbol-modified");
	icon.append(use);
	header.append(icon, add, del);
	root.append(header);
	return { host, root, header, use };
};

const addSymbol = (root: ShadowRoot, id: string): void => {
	const symbol = document.createElementNS(SVG_NS, "symbol");
	symbol.setAttribute("id", id);
	root.append(symbol);
};

const entry = (over: Partial<ImageEntry> = {}): ImageEntry => ({
	name: "logo.png",
	oldPath: "logo.png",
	status: "modified",
	showOld: true,
	showNew: true,
	version: "v1",
	...over,
});

const makeUrlFor = () =>
	mock(
		(path: string, side: "old" | "new", version?: string) =>
			`blob://${path}/${side}/${version ?? ""}`,
	);

describe("ensureImageCard", () => {
	test("inserts a card after the header with old/new panes and hides the stat counts", () => {
		const { root, header } = makeContainer();
		const urlFor = makeUrlFor();
		const e = entry();

		ensureImageCard(root as unknown as HTMLElement, e, false, urlFor);

		const card = root.querySelector("[data-image-card]");
		expect(card).not.toBeNull();
		expect(header.nextElementSibling).toBe(card);
		expect(card?.getAttribute("data-image-card")).toBe("v1");

		const oldPane = card?.querySelector(".img-pane--old");
		const newPane = card?.querySelector(".img-pane--new");
		expect(oldPane).not.toBeNull();
		expect(newPane).not.toBeNull();

		const oldImg = oldPane?.querySelector("img");
		const newImg = newPane?.querySelector("img");
		expect(oldImg?.getAttribute("src")).toBe("blob://logo.png/old/v1");
		expect(newImg?.getAttribute("src")).toBe("blob://logo.png/new/v1");
		expect(urlFor).toHaveBeenCalledWith("logo.png", "old", "v1");
		expect(urlFor).toHaveBeenCalledWith("logo.png", "new", "v1");

		const addEl = root.querySelector<HTMLElement>("[data-additions-count]");
		const delEl = root.querySelector<HTMLElement>("[data-deletions-count]");
		expect(addEl?.style.display).toBe("none");
		expect(delEl?.style.display).toBe("none");
	});

	test("idempotent: a second call with the same version leaves a single unchanged card", () => {
		const { root } = makeContainer();
		const urlFor = makeUrlFor();
		const e = entry();

		ensureImageCard(root as unknown as HTMLElement, e, false, urlFor);
		const firstCard = root.querySelector("[data-image-card]");
		const callsAfterFirst = urlFor.mock.calls.length;

		ensureImageCard(root as unknown as HTMLElement, e, false, urlFor);

		const cards = root.querySelectorAll("[data-image-card]");
		expect(cards.length).toBe(1);
		expect(cards[0]).toBe(firstCard);
		expect(urlFor.mock.calls.length).toBe(callsAfterFirst);
	});

	test("a version change replaces the card", () => {
		const { root } = makeContainer();
		const urlFor = makeUrlFor();

		ensureImageCard(
			root as unknown as HTMLElement,
			entry({ version: "v1" }),
			false,
			urlFor,
		);
		const firstCard = root.querySelector("[data-image-card]");

		ensureImageCard(
			root as unknown as HTMLElement,
			entry({ version: "v2" }),
			false,
			urlFor,
		);

		const cards = root.querySelectorAll("[data-image-card]");
		expect(cards.length).toBe(1);
		expect(cards[0]).not.toBe(firstCard);
		expect(cards[0]?.getAttribute("data-image-card")).toBe("v2");
	});

	test("collapsed=true removes an existing card", () => {
		const { root } = makeContainer();
		const urlFor = makeUrlFor();

		ensureImageCard(root as unknown as HTMLElement, entry(), false, urlFor);
		expect(root.querySelector("[data-image-card]")).not.toBeNull();

		ensureImageCard(root as unknown as HTMLElement, entry(), true, urlFor);
		expect(root.querySelector("[data-image-card]")).toBeNull();
	});

	test("entry=undefined removes an existing card", () => {
		const { root } = makeContainer();
		const urlFor = makeUrlFor();

		ensureImageCard(root as unknown as HTMLElement, entry(), false, urlFor);
		expect(root.querySelector("[data-image-card]")).not.toBeNull();

		ensureImageCard(root as unknown as HTMLElement, undefined, false, urlFor);
		expect(root.querySelector("[data-image-card]")).toBeNull();
	});

	test("entry=undefined with no existing card does not throw", () => {
		const { root } = makeContainer();
		const urlFor = makeUrlFor();

		expect(() =>
			ensureImageCard(root as unknown as HTMLElement, undefined, false, urlFor),
		).not.toThrow();
		expect(root.querySelector("[data-image-card]")).toBeNull();
	});

	test("showOld=false renders only the new pane", () => {
		const { root } = makeContainer();
		const urlFor = makeUrlFor();

		ensureImageCard(
			root as unknown as HTMLElement,
			entry({ showOld: false }),
			false,
			urlFor,
		);

		const card = root.querySelector("[data-image-card]");
		expect(card?.querySelector(".img-pane--old")).toBeNull();
		expect(card?.querySelector(".img-pane--new")).not.toBeNull();
	});

	test("showNew=false renders only the old pane", () => {
		const { root } = makeContainer();
		const urlFor = makeUrlFor();

		ensureImageCard(
			root as unknown as HTMLElement,
			entry({ showNew: false }),
			false,
			urlFor,
		);

		const card = root.querySelector("[data-image-card]");
		expect(card?.querySelector(".img-pane--old")).not.toBeNull();
		expect(card?.querySelector(".img-pane--new")).toBeNull();
	});

	describe("status icon swap", () => {
		const cases: Array<{ status: ImageEntry["status"]; symbol: string }> = [
			{ status: "added", symbol: "added" },
			{ status: "untracked", symbol: "added" },
			{ status: "deleted", symbol: "deleted" },
			{ status: "renamed", symbol: "renamed" },
		];

		for (const { status, symbol } of cases) {
			test(`status=${status} swaps the header icon to #diffs-icon-symbol-${symbol} when the symbol exists`, () => {
				const { root, use } = makeContainer();
				addSymbol(root, `diffs-icon-symbol-${symbol}`);
				const urlFor = makeUrlFor();

				ensureImageCard(
					root as unknown as HTMLElement,
					entry({ status }),
					false,
					urlFor,
				);

				expect(use.getAttribute("href")).toBe(`#diffs-icon-symbol-${symbol}`);
			});
		}

		test("no-op (no throw, href unchanged) when the matching symbol is absent", () => {
			const { root, use } = makeContainer();
			const urlFor = makeUrlFor();

			expect(() =>
				ensureImageCard(
					root as unknown as HTMLElement,
					entry({ status: "added" }),
					false,
					urlFor,
				),
			).not.toThrow();

			expect(use.getAttribute("href")).toBe("#diffs-icon-symbol-modified");
		});

		test("status=modified has no mapped symbol and leaves the icon untouched", () => {
			const { root, use } = makeContainer();
			addSymbol(root, "diffs-icon-symbol-modified");
			const urlFor = makeUrlFor();

			ensureImageCard(
				root as unknown as HTMLElement,
				entry({ status: "modified" }),
				false,
				urlFor,
			);

			expect(use.getAttribute("href")).toBe("#diffs-icon-symbol-modified");
		});
	});

	test("falls back to the container itself when there is no shadow root", () => {
		const container = document.createElement("div");
		const header = document.createElement("div");
		header.setAttribute(DIFFS_HEADER_ATTR, "");
		container.append(header);
		const urlFor = makeUrlFor();

		ensureImageCard(container, entry(), false, urlFor);

		const card = container.querySelector("[data-image-card]");
		expect(card).not.toBeNull();
		expect(header.nextElementSibling).toBe(card);
	});
});
