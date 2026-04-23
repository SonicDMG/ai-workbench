import { Beaker, CircleDashed, Database, Server } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceKind } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type Meta = {
	label: string;
	description: string;
	icon: ReactNode;
	recommended?: boolean;
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
		description:
			"Hyper-Converged DB — Astra's self-hosted cousin. Routing TBD.",
		icon: <Server className="h-6 w-6" />,
	},
	openrag: {
		label: "OpenRAG",
		description: "The OpenRAG project. Routing TBD.",
		icon: <CircleDashed className="h-6 w-6" />,
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
				return (
					<button
						key={k}
						type="button"
						onClick={() => onChange(k)}
						aria-pressed={selected}
						className={cn(
							"group relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-all",
							"focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
							selected
								? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] ring-1 ring-[var(--color-brand-500)]"
								: "border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm",
						)}
					>
						<div className="flex items-center justify-between">
							<span
								className={cn(
									"flex h-10 w-10 items-center justify-center rounded-lg",
									selected
										? "bg-[var(--color-brand-600)] text-white"
										: "bg-zinc-100 text-zinc-600 group-hover:bg-zinc-200",
								)}
							>
								{m.icon}
							</span>
							{m.recommended ? (
								<span className="text-xs font-medium text-[var(--color-brand-700)]">
									Recommended
								</span>
							) : null}
						</div>
						<div>
							<p className="font-semibold text-zinc-900">{m.label}</p>
							<p className="mt-1 text-sm text-zinc-500 leading-relaxed">
								{m.description}
							</p>
						</div>
					</button>
				);
			})}
		</div>
	);
}
