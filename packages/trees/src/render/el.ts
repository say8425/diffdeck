// Minimal vanilla DOM builder used by the de-preact view code. Mirrors the
// subset of JSX-attribute semantics the ported components rely on: boolean
// `true` -> attribute present (empty string value), `false`/`null`/`undefined`
// -> attribute omitted, `style` object -> per-property `element.style`
// assignment, `tabIndex` -> DOM property (not an attribute). String children
// are appended as text nodes only -- never via `innerHTML` -- so untrusted
// content can never be interpreted as markup.
//
// Exception: `aria-*`/`data-*` attributes have no boolean representation in
// the DOM, and real preact's `setProperty` (preact/src/diff/props.js)
// special-cases exactly those two prefixes to always
// `dom.setAttribute(name, value)` (coerced to "true"/"false"), never omitting
// on `false`. So a boolean value on a key matching `^(aria|data)-` is always
// stringified and set -- `true` -> `"true"`, `false` -> `"false"` -- rather
// than following the present/omit convention used for every other attribute.

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ARIA_OR_DATA_PREFIX = /^(aria|data)-/;

export type ElAttrs = Record<string, unknown>;
export type ElChild = Node | string;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const applyStyle = (
	element: HTMLElement | SVGElement,
	style: unknown,
): void => {
	if (!isPlainObject(style)) {
		return;
	}
	for (const [prop, value] of Object.entries(style)) {
		if (value === undefined) {
			continue;
		}
		// `element.style` is a CSSStyleDeclaration; index access covers both
		// camelCase and custom-property keys without a per-key allowlist.
		(element.style as unknown as Record<string, string>)[prop] = String(value);
	}
};

const applyAttrs = (
	element: HTMLElement | SVGElement,
	attrs: ElAttrs | undefined,
): void => {
	if (attrs == null) {
		return;
	}
	for (const [key, value] of Object.entries(attrs)) {
		if (typeof value === "boolean" && ARIA_OR_DATA_PREFIX.test(key)) {
			element.setAttribute(key, String(value));
			continue;
		}
		if (value === false || value === null || value === undefined) {
			continue;
		}
		if (key === "style") {
			applyStyle(element, value);
			continue;
		}
		if (key === "tabIndex") {
			(element as HTMLElement).tabIndex = value as number;
			continue;
		}
		if (value === true) {
			element.setAttribute(key, "");
			continue;
		}
		element.setAttribute(key, String(value));
	}
};

const appendChildren = (
	element: HTMLElement | SVGElement,
	children: ElChild[] | undefined,
): void => {
	if (children == null) {
		return;
	}
	for (const child of children) {
		if (typeof child === "string") {
			element.appendChild(document.createTextNode(child));
			continue;
		}
		element.appendChild(child);
	}
};

export const el = (
	tag: string,
	attrs?: ElAttrs,
	children?: ElChild[],
): HTMLElement => {
	const element = document.createElement(tag);
	applyAttrs(element, attrs);
	appendChildren(element, children);
	return element;
};

export const svgEl = (
	tag: string,
	attrs?: ElAttrs,
	children?: ElChild[],
): SVGElement => {
	const element = document.createElementNS(SVG_NAMESPACE, tag) as SVGElement;
	applyAttrs(element, attrs);
	appendChildren(element, children);
	return element;
};
