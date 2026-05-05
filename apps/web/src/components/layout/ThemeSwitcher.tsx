import { Monitor, Moon, Sun } from "lucide-react";
import type { ComponentType } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@/components/ui/select";
import { type Theme, useTheme } from "@/hooks/useTheme";

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
 * Compact Light / Dark / System picker rendered into the header.
 * Uses the same Radix Select primitive as the workspace switcher so
 * the header chrome stays visually consistent.
 */
export function ThemeSwitcher() {
	const { theme, setTheme } = useTheme();
	const Icon = ICON_BY_THEME[theme];

	return (
		<Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
			<SelectTrigger
				aria-label="Theme"
				className="h-9 w-auto gap-1.5 border-slate-200 bg-slate-50 px-2.5 shadow-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
			>
				<span className="flex items-center gap-1.5">
					<Icon className="h-4 w-4" />
					<span className="hidden text-xs sm:inline-block">
						{LABEL_BY_THEME[theme]}
					</span>
				</span>
			</SelectTrigger>
			<SelectContent align="end">
				<SelectItem value="light">
					<span className="flex items-center gap-2">
						<Sun className="h-4 w-4" />
						Light
					</span>
				</SelectItem>
				<SelectItem value="dark">
					<span className="flex items-center gap-2">
						<Moon className="h-4 w-4" />
						Dark
					</span>
				</SelectItem>
				<SelectItem value="system">
					<span className="flex items-center gap-2">
						<Monitor className="h-4 w-4" />
						System
					</span>
				</SelectItem>
			</SelectContent>
		</Select>
	);
}
