import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Belt-and-suspenders: vitest already calls cleanup between files when
// `restoreMocks: true` clears module-level state, but RTL's own
// auto-cleanup only fires when the test runner exposes its globals.
// We disabled `globals` in vitest.config.ts to keep imports explicit,
// so we run cleanup ourselves.
afterEach(() => {
	cleanup();
});

// Node 25 (rolled in late-April-2026 CI image bumps) ships an
// experimental built-in `localStorage` gated on `--localstorage-file`.
// Without the flag, the binding is materialised as a method-less
// object stub, which then shadows jsdom's own Storage on
// `window.localStorage` — `getItem` / `setItem` / `clear` are all
// `undefined`, so any component test that exercises real-storage
// state explodes with "X is not a function".
//
// Polyfill scope: only when the existing binding lacks the methods
// we need. A correctly-shaped Storage (jsdom's, Node's once flagged,
// or anything else) is left alone.
if (
	typeof window !== "undefined" &&
	typeof window.localStorage?.setItem !== "function"
) {
	const store = new Map<string, string>();
	const shim: Storage = {
		get length() {
			return store.size;
		},
		clear() {
			store.clear();
		},
		getItem(key) {
			return store.has(key) ? (store.get(key) ?? null) : null;
		},
		key(index) {
			return Array.from(store.keys())[index] ?? null;
		},
		removeItem(key) {
			store.delete(key);
		},
		setItem(key, value) {
			store.set(key, String(value));
		},
	};
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: shim,
	});
}

// Radix UI Select (and other pointer-capture primitives) call
// `hasPointerCapture` / `releasePointerCapture` / `scrollIntoView`
// during click handling. jsdom doesn't implement them, so opening a
// `<Select>` from a test throws `TypeError: target.hasPointerCapture
// is not a function`. Stub the three methods on the prototype so
// every Radix-driven test sees them.
if (typeof window !== "undefined" && typeof Element !== "undefined") {
	const proto = Element.prototype as Element & {
		hasPointerCapture?: (id: number) => boolean;
		releasePointerCapture?: (id: number) => void;
		scrollIntoView?: () => void;
	};
	if (typeof proto.hasPointerCapture !== "function") {
		proto.hasPointerCapture = () => false;
	}
	if (typeof proto.releasePointerCapture !== "function") {
		proto.releasePointerCapture = () => undefined;
	}
	if (typeof proto.scrollIntoView !== "function") {
		proto.scrollIntoView = () => undefined;
	}
}
