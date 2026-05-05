import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { DocumentStatus } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const STYLES: Record<
	DocumentStatus,
	{ label: string; className: string; spin?: boolean }
> = {
	ready: {
		label: "ready",
		className:
			"bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50",
	},
	failed: {
		label: "failed",
		className:
			"bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50",
	},
	writing: {
		label: "writing",
		className:
			"bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
		spin: true,
	},
	chunking: {
		label: "chunking",
		className:
			"bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900/50",
		spin: true,
	},
	embedding: {
		label: "embedding",
		className:
			"bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/50",
		spin: true,
	},
	pending: {
		label: "pending",
		className:
			"bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
		spin: true,
	},
};

/**
 * Pill-shaped status badge for a `Document.status`. Spinner glyph
 * for in-flight states (`pending`/`writing`/`chunking`/`embedding`),
 * a green check for `ready`, a triangle for `failed`. Colors mirror
 * the catalog explorer + ingest queue UX.
 */
export function DocumentStatusBadge({
	status,
	className,
}: {
	status: DocumentStatus;
	className?: string;
}) {
	const style = STYLES[status];
	const Icon =
		status === "ready"
			? CheckCircle2
			: status === "failed"
				? AlertTriangle
				: Loader2;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
				style.className,
				className,
			)}
		>
			<Icon
				className={cn("h-3 w-3", style.spin && "animate-spin")}
				aria-hidden
			/>
			{style.label}
		</span>
	);
}
