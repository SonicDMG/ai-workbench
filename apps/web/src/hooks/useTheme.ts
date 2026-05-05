import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "aiwb.theme";

function isTheme(value: unknown): value is Theme {
	return value === "light" || value === "dark" || value === "system";
}

export function readStoredTheme(): Theme {
	if (typeof window === "undefined") return "system";
	try {
		const value = window.localStorage.getItem(THEME_STORAGE_KEY);
		return isTheme(value) ? value : "system";
	} catch {
		return "system";
	}
}

function systemPrefersDark(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function")
		return false;
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(theme: Theme): ResolvedTheme {
	if (theme === "system") return systemPrefersDark() ? "dark" : "light";
	return theme;
}

export function applyTheme(resolved: ResolvedTheme): void {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	if (resolved === "dark") root.classList.add("dark");
	else root.classList.remove("dark");
	root.dataset.theme = resolved;
}

/**
 * Theme preference hook. Persists to localStorage under
 * `aiwb.theme`, mirrors the choice to `<html class="dark">` so
 * Tailwind's class-based dark variant fires, and tracks the OS
 * preference whenever the user's choice is "system".
 *
 * The pre-React inline script in index.html applies the same
 * resolution before paint to avoid a light-flash; this hook keeps
 * the class in sync once React is mounted and after media-query
 * or cross-tab changes.
 */
export function useTheme() {
	const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

	useEffect(() => {
		applyTheme(resolveTheme(theme));
		if (theme !== "system") return;
		if (
			typeof window === "undefined" ||
			typeof window.matchMedia !== "function"
		)
			return;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const handle = () => applyTheme(media.matches ? "dark" : "light");
		media.addEventListener("change", handle);
		return () => media.removeEventListener("change", handle);
	}, [theme]);

	useEffect(() => {
		const onStorage = (event: StorageEvent) => {
			if (event.key !== THEME_STORAGE_KEY) return;
			setThemeState(readStoredTheme());
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const setTheme = (next: Theme) => {
		try {
			window.localStorage.setItem(THEME_STORAGE_KEY, next);
		} catch {
			// Storage unavailable (private mode, quota) — fall back to
			// in-memory state only.
		}
		setThemeState(next);
	};

	return { theme, setTheme, resolved: resolveTheme(theme) };
}
