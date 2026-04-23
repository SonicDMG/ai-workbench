import type { WorkspaceKind } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const styles: Record<WorkspaceKind, string> = {
	astra: "bg-indigo-50 text-indigo-700 ring-indigo-200",
	hcd: "bg-amber-50 text-amber-700 ring-amber-200",
	openrag: "bg-emerald-50 text-emerald-700 ring-emerald-200",
	mock: "bg-zinc-100 text-zinc-700 ring-zinc-200",
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
