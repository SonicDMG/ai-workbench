import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { DocumentStatus } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const STYLES: Record<
	DocumentStatus,
	{ label: string; className: string; spin?: boolean }
> = {
	ready: {
		label: "ready",
		className: "bg-emerald-50 text-emerald-700 border-emerald-200",
	},
	failed: {
		label: "failed",
		className: "bg-red-50 text-red-700 border-red-200",
	},
	writing: {
		label: "writing",
		className: "bg-slate-100 text-slate-600 border-slate-200",
		spin: true,
	},
	chunking: {
		label: "chunking",
		className: "bg-sky-50 text-sky-700 border-sky-200",
		spin: true,
	},
	embedding: {
		label: "embedding",
		className: "bg-indigo-50 text-indigo-700 border-indigo-200",
		spin: true,
	},
	pending: {
		label: "pending",
		className: "bg-slate-100 text-slate-600 border-slate-200",
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
