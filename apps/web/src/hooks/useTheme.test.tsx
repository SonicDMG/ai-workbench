import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTheme, THEME_STORAGE_KEY, useTheme } from "@/hooks/useTheme";

type MediaListener = (event: { matches: boolean }) => void;

function mockMatchMedia(prefersDark: boolean) {
	const listeners = new Set<MediaListener>();
	const mql = {
		matches: prefersDark,
		media: "(prefers-color-scheme: dark)",
		onchange: null,
		addEventListener: (_: string, l: MediaListener) => {
			listeners.add(l);
		},
		removeEventListener: (_: string, l: MediaListener) => {
			listeners.delete(l);
		},
		addListener: (l: MediaListener) => {
			listeners.add(l);
		},
		removeListener: (l: MediaListener) => {
			listeners.delete(l);
		},
		dispatchEvent: () => true,
	} as unknown as MediaQueryList & { _listeners: Set<MediaListener> };
	(mql as unknown as { _listeners: Set<MediaListener> })._listeners = listeners;
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		writable: true,
		value: vi.fn().mockReturnValue(mql),
	});
	return mql as MediaQueryList & { _listeners: Set<MediaListener> };
}

describe("resolveTheme", () => {
	beforeEach(() => {
		mockMatchMedia(false);
	});

	it("returns the chosen theme verbatim for explicit values", () => {
		expect(resolveTheme("light")).toBe("light");
		expect(resolveTheme("dark")).toBe("dark");
	});

	it("follows the system preference for 'system'", () => {
		mockMatchMedia(true);
		expect(resolveTheme("system")).toBe("dark");
		mockMatchMedia(false);
		expect(resolveTheme("system")).toBe("light");
	});
});

describe("useTheme", () => {
	beforeEach(() => {
		window.localStorage.clear();
		document.documentElement.classList.remove("dark");
		mockMatchMedia(false);
	});

	afterEach(() => {
		window.localStorage.clear();
		document.documentElement.classList.remove("dark");
	});

	it("defaults to 'system' when nothing is stored", () => {
		const { result } = renderHook(() => useTheme());
		expect(result.current.theme).toBe("system");
		expect(result.current.resolved).toBe("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	it("applies stored 'dark' preference and toggles the html class", () => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
		const { result } = renderHook(() => useTheme());
		expect(result.current.theme).toBe("dark");
		expect(result.current.resolved).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("persists changes to localStorage and updates the html class", () => {
		const { result } = renderHook(() => useTheme());
		act(() => {
			result.current.setTheme("dark");
		});
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		act(() => {
			result.current.setTheme("light");
		});
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	it("follows OS dark preference when set to 'system'", () => {
		mockMatchMedia(true);
		const { result } = renderHook(() => useTheme());
		expect(result.current.resolved).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("ignores corrupt stored values and falls back to 'system'", () => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "neon");
		const { result } = renderHook(() => useTheme());
		expect(result.current.theme).toBe("system");
	});
});
