import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAuthToken,
	previewToken,
	setAuthToken,
	subscribe,
} from "./authToken";

// vitest's jsdom build ships a partial Storage shim — clear() and
// removeItem() aren't always present. Each test calls setAuthToken()
// so we can roll our own teardown by swapping the backing store.
const STORAGE_KEY = "wb_auth_token";

function resetStorage(): void {
	const fakeStore: Record<string, string> = {};
	const fakeStorage: Storage = {
		get length() {
			return Object.keys(fakeStore).length;
		},
		key(i) {
			return Object.keys(fakeStore)[i] ?? null;
		},
		getItem(k) {
			return fakeStore[k] ?? null;
		},
		setItem(k, v) {
			fakeStore[k] = v;
		},
		removeItem(k) {
			delete fakeStore[k];
		},
		clear() {
			for (const k of Object.keys(fakeStore)) delete fakeStore[k];
		},
	};
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		writable: true,
		value: fakeStorage,
	});
}

describe("authToken get/set", () => {
	beforeEach(() => {
		resetStorage();
	});
	afterEach(() => {
		// Drop the per-test storage; setAuthToken() in the next test
		// will operate against a fresh one via beforeEach.
		window.localStorage.removeItem(STORAGE_KEY);
	});

	it("returns null when nothing is stored", () => {
		expect(getAuthToken()).toBeNull();
	});

	it("round-trips a stored token", () => {
		setAuthToken("wb_live_abcdef012345_DEADBEEF000011112222333344445555");
		expect(getAuthToken()).toBe(
			"wb_live_abcdef012345_DEADBEEF000011112222333344445555",
		);
	});

	it("clears on null and on empty string", () => {
		setAuthToken("token-1");
		setAuthToken(null);
		expect(getAuthToken()).toBeNull();
		setAuthToken("token-2");
		setAuthToken("");
		expect(getAuthToken()).toBeNull();
	});

	it("notifies subscribers when the token changes", () => {
		const fn = vi.fn();
		const off = subscribe(fn);
		setAuthToken("xyz");
		setAuthToken(null);
		off();
		// First call: set; second: clear.
		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenNthCalledWith(1, "xyz");
		expect(fn).toHaveBeenNthCalledWith(2, null);
	});

	it("unsubscribe stops further callbacks", () => {
		const fn = vi.fn();
		const off = subscribe(fn);
		off();
		setAuthToken("xyz");
		expect(fn).not.toHaveBeenCalled();
	});
});

describe("previewToken", () => {
	it("hides the secret half of a wb_live_ token", () => {
		expect(
			previewToken("wb_live_abcdef012345_DEADBEEF000011112222333344445555"),
		).toBe("wb_live_abcdef012345_…");
	});

	it("returns 'No token' for null", () => {
		expect(previewToken(null)).toBe("No token");
	});

	it("falls back to a 16-char preview for non-conforming tokens", () => {
		expect(previewToken("opaque-token-value-12345678")).toBe(
			"opaque-token-val…",
		);
	});
});
