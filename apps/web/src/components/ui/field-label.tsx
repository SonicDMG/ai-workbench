import { Info } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FieldLabel({
	htmlFor,
	children,
	help,
	className,
}: {
	htmlFor?: string;
	children: ReactNode;
	help?: string;
	className?: string;
}) {
	const tooltipId = useId();
	return (
		<div className={cn("flex items-center gap-1.5", className)}>
			<Label htmlFor={htmlFor}>{children}</Label>
			{help ? (
				<span className="group relative inline-flex">
					<button
						type="button"
						className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
						aria-label="Field information"
						aria-describedby={tooltipId}
					>
						<Info className="h-3.5 w-3.5" aria-hidden />
					</button>
					<span
						id={tooltipId}
						role="tooltip"
						className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden w-72 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-normal leading-5 text-slate-700 shadow-lg group-hover:block group-focus-within:block"
					>
						{help}
					</span>
				</span>
			) : null}
		</div>
	);
}
