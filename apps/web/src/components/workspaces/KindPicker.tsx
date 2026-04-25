import { Beaker, CircleDashed, Database, Server } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceKind } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type Meta = {
	label: string;
	description: string;
	icon: ReactNode;
	recommended?: boolean;
	/**
	 * Tile is visible but not selectable. Reserved for kinds that exist
	 * in the runtime schema but don't yet have a driver wired up — we
	 * keep them on the picker so the product roadmap is visible to
	 * first-run users, but block selection so the next step doesn't
	 * stall out on driver_unavailable.
	 */
	comingSoon?: boolean;
};

const meta: Record<WorkspaceKind, Meta> = {
	astra: {
		label: "Astra DB",
		description:
			"Managed DataStax cloud DB via the Data API. Production-grade.",
		icon: <Database className="h-6 w-6" />,
		recommended: true,
	},
	mock: {
		label: "Mock",
		description: "In-memory, no credentials. Great for first-run exploration.",
		icon: <Beaker className="h-6 w-6" />,
	},
	hcd: {
		label: "HCD",
		description: "Hyper-Converged DB — Astra's self-hosted cousin.",
		icon: <Server className="h-6 w-6" />,
		comingSoon: true,
	},
	openrag: {
		label: "OpenRAG",
		description: "The OpenRAG project.",
		icon: <CircleDashed className="h-6 w-6" />,
		comingSoon: true,
	},
};

const order: WorkspaceKind[] = ["astra", "mock", "hcd", "openrag"];

export function KindPicker({
	value,
	onChange,
}: {
	value: WorkspaceKind | null;
	onChange: (kind: WorkspaceKind) => void;
}) {
	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
			{order.map((k) => {
				const m = meta[k];
				const selected = value === k;
				const disabled = Boolean(m.comingSoon);
				return (
					<button
						key={k}
						type="button"
						onClick={disabled ? undefined : () => onChange(k)}
						disabled={disabled}
						aria-pressed={disabled ? undefined : selected}
						aria-disabled={disabled || undefined}
						title={
							disabled
								? `${m.label} support is on the roadmap but not wired up yet.`
								: undefined
						}
						className={cn(
							"group relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-all",
							"focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
							disabled
								? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-70"
								: selected
									? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] ring-1 ring-[var(--color-brand-500)]"
									: "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm",
						)}
					>
						<div className="flex items-center justify-between">
							<span
								className={cn(
									"flex h-10 w-10 items-center justify-center rounded-lg",
									disabled
										? "bg-slate-100 text-slate-400"
										: selected
											? "bg-[var(--color-brand-600)] text-white"
											: "bg-slate-100 text-slate-600 group-hover:bg-slate-200",
								)}
							>
								{m.icon}
							</span>
							{m.recommended ? (
								<span className="text-xs font-medium text-[var(--color-brand-700)]">
									Recommended
								</span>
							) : null}
							{disabled ? (
								<span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-600">
									Coming soon
								</span>
							) : null}
						</div>
						<div>
							<p
								className={cn(
									"font-semibold",
									disabled ? "text-slate-500" : "text-slate-900",
								)}
							>
								{m.label}
							</p>
							<p
								className={cn(
									"mt-1 text-sm leading-relaxed",
									disabled ? "text-slate-400" : "text-slate-500",
								)}
							>
								{m.description}
							</p>
						</div>
					</button>
				);
			})}
		</div>
	);
}
