import { Monitor, Moon, Sun } from "lucide-react";
import type { ComponentType } from "react";
import { type Theme, useTheme } from "@/hooks/useTheme";

const CYCLE: Readonly<Record<Theme, Theme>> = {
	light: "dark",
	dark: "system",
	system: "light",
};

const ICON_BY_THEME: Record<Theme, ComponentType<{ className?: string }>> = {
	light: Sun,
	dark: Moon,
	system: Monitor,
};

const LABEL_BY_THEME: Record<Theme, string> = {
	light: "Light",
	dark: "Dark",
	system: "System",
};

/**
 * Icon-only theme toggle. Click cycles light → dark → system → light
 * so the header doesn't need a dropdown — matches the other
 * icon-only header affordances (API docs, Settings, What's new,
 * UserMenu). Tooltip names both the current mode and the next one
 * so the cycle is discoverable without a menu.
 */
export function ThemeSwitcher() {
	const { theme, setTheme } = useTheme();
	const Icon = ICON_BY_THEME[theme];
	const next = CYCLE[theme];
	const title = `Theme: ${LABEL_BY_THEME[theme]} (click for ${LABEL_BY_THEME[next]})`;

	return (
		<button
			type="button"
			onClick={() => setTheme(next)}
			aria-label={title}
			title={title}
			className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#525252] transition-colors hover:bg-[#f4f4f4] hover:text-[#161616] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
		>
			<Icon className="h-4 w-4" />
		</button>
	);
}
