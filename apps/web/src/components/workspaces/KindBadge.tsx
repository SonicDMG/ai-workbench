import type { WorkspaceKind } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const styles: Record<WorkspaceKind, string> = {
	astra:
		"bg-[var(--color-brand-50)] text-[var(--color-brand-700)] ring-[var(--color-brand-200)]",
	hcd: "bg-amber-50 text-amber-700 ring-amber-200",
	openrag: "bg-teal-50 text-teal-700 ring-teal-200",
	mock: "bg-slate-100 text-slate-700 ring-slate-200",
};

const labels: Record<WorkspaceKind, string> = {
	astra: "Astra",
	hcd: "HCD",
	openrag: "OpenRAG",
	mock: "Mock",
};

export function KindBadge({
	kind,
	className,
}: {
	kind: WorkspaceKind;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
				styles[kind],
				className,
			)}
		>
			{labels[kind]}
		</span>
	);
}
