import "./happydom.ts";
import { afterEach, describe, expect, jest, mock, spyOn, test } from "bun:test";
import { createCopyButton } from "../browser/copyButton.ts";

const RESET_MS = 1200;
const COPY_SVG_HINT = 'rect x="9" y="9" width="13" height="13" rx="2" ry="2"';
const CHECK_SVG_HINT = 'polyline points="20 6 9 17 4 12"';

// navigator.clipboard is a non-configurable-value prototype getter in
// happy-dom; shadowing it with an own property (via defineProperty) and then
// deleting that own property restores the prototype getter afterward.
const setClipboard = (value: unknown): void => {
	Object.defineProperty(navigator, "clipboard", { value, configurable: true });
};
const restoreClipboard = (): void => {
	// biome-ignore lint: test-only cleanup of a shadowed own property
	delete (navigator as { clipboard?: unknown }).clipboard;
};

// Two microtask ticks: one for the writeText() promise settling, one for the
// .then(showCopied) callback it schedules.
const tick = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
};

afterEach(() => {
	restoreClipboard();
	jest.useRealTimers();
});

describe("createCopyButton", () => {
	test("returns a configured copy button with the copy icon", () => {
		const btn = createCopyButton("src/foo.ts");
		expect(btn.tagName).toBe("BUTTON");
		expect(btn.type).toBe("button");
		expect(btn.hasAttribute("data-copy-name")).toBe(true);
		expect(btn.getAttribute("data-copy-name")).toBe("");
		expect(btn.getAttribute("aria-label")).toBe("Copy file path");
		expect(btn.getAttribute("title")).toBe("Copy path");
		expect(btn.innerHTML).toContain(COPY_SVG_HINT);
	});

	test("click copies the path, shows the check icon, then reverts after RESET_MS", async () => {
		const writeText = mock((_text: string) => Promise.resolve());
		setClipboard({ writeText });
		jest.useFakeTimers();

		const btn = createCopyButton("src/foo.ts");
		btn.click();

		expect(writeText).toHaveBeenCalledWith("src/foo.ts");
		await tick();

		expect(btn.innerHTML).toContain(CHECK_SVG_HINT);
		expect(btn.getAttribute("aria-label")).toBe("Copied");
		expect(btn.getAttribute("title")).toBe("Copied");

		jest.advanceTimersByTime(RESET_MS - 1);
		expect(btn.innerHTML).toContain(CHECK_SVG_HINT);
		expect(btn.getAttribute("aria-label")).toBe("Copied");

		jest.advanceTimersByTime(1);
		expect(btn.innerHTML).toContain(COPY_SVG_HINT);
		expect(btn.getAttribute("aria-label")).toBe("Copy file path");
		expect(btn.getAttribute("title")).toBe("Copy path");
	});

	test("a second click while the first timer is pending restarts the timer instead of double-reverting", async () => {
		const writeText = mock((_text: string) => Promise.resolve());
		setClipboard({ writeText });
		jest.useFakeTimers();

		const btn = createCopyButton("src/foo.ts");
		btn.click();
		await tick();
		expect(btn.getAttribute("aria-label")).toBe("Copied");

		jest.advanceTimersByTime(800);
		btn.click();
		await tick();
		expect(btn.getAttribute("aria-label")).toBe("Copied");
		expect(writeText).toHaveBeenCalledTimes(2);

		// The first timer would have fired here (800 + 400 = 1200ms since the
		// first click) had the second click not cleared it.
		jest.advanceTimersByTime(400);
		expect(btn.getAttribute("aria-label")).toBe("Copied");
		expect(btn.innerHTML).toContain(CHECK_SVG_HINT);

		// The restarted timer fires 1200ms after the *second* click.
		jest.advanceTimersByTime(800);
		expect(btn.getAttribute("aria-label")).toBe("Copy file path");
		expect(btn.innerHTML).toContain(COPY_SVG_HINT);
	});

	test("pointerdown and click both stop propagation so the header fold never toggles", () => {
		const writeText = mock((_text: string) => Promise.resolve());
		setClipboard({ writeText });

		const parent = document.createElement("div");
		const btn = createCopyButton("src/foo.ts");
		parent.appendChild(btn);
		document.body.appendChild(parent);

		const parentPointerdown = mock(() => {});
		const parentClick = mock(() => {});
		parent.addEventListener("pointerdown", parentPointerdown);
		parent.addEventListener("click", parentClick);

		btn.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
		);
		btn.click();

		expect(parentPointerdown).not.toHaveBeenCalled();
		expect(parentClick).not.toHaveBeenCalled();
	});

	test("missing clipboard API warns and does not throw", () => {
		setClipboard(undefined);
		const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

		const btn = createCopyButton("src/foo.ts");
		expect(() => btn.click()).not.toThrow();

		expect(warnSpy).toHaveBeenCalledWith("clipboard API unavailable");
		expect(btn.innerHTML).toContain(COPY_SVG_HINT);
		expect(btn.getAttribute("aria-label")).toBe("Copy file path");

		warnSpy.mockRestore();
	});

	test("clipboard object without writeText also warns and does not throw", () => {
		setClipboard({});
		const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

		const btn = createCopyButton("src/foo.ts");
		expect(() => btn.click()).not.toThrow();

		expect(warnSpy).toHaveBeenCalledWith("clipboard API unavailable");

		warnSpy.mockRestore();
	});

	test("a rejected clipboard write warns with the error and never shows the check icon", async () => {
		const writeError = new Error("denied");
		const writeText = mock((_text: string) => Promise.reject(writeError));
		setClipboard({ writeText });
		const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

		const btn = createCopyButton("src/foo.ts");
		btn.click();
		await tick();

		expect(warnSpy).toHaveBeenCalledWith(writeError);
		expect(btn.innerHTML).toContain(COPY_SVG_HINT);
		expect(btn.getAttribute("aria-label")).toBe("Copy file path");

		warnSpy.mockRestore();
	});
});
