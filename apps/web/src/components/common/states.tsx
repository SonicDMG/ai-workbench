import { AlertCircle, Loader2 } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
	return (
		<div className="flex items-center gap-3 text-slate-500 p-8 justify-center">
			<Loader2 className="h-5 w-5 animate-spin" />
			<span className="text-sm">{label}</span>
		</div>
	);
}

export function ErrorState({
	title = "Something went wrong",
	message,
	actions,
}: {
	title?: string;
	message: string;
	actions?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col items-center gap-3 p-8 text-center">
			<AlertCircle className="h-8 w-8 text-red-500" />
			<div>
				<p className="text-sm font-medium text-slate-900">{title}</p>
				<p className="text-sm text-slate-500 mt-1">{message}</p>
			</div>
			{actions ? <div className="flex gap-2">{actions}</div> : null}
		</div>
	);
}

export function EmptyState({
	icon,
	title,
	description,
	actions,
	className,
}: {
	icon?: React.ReactNode;
	title: string;
	description?: string;
	actions?: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-slate-300 bg-white/60 p-12",
				className,
			)}
		>
			{icon ? <div className="mb-4 text-slate-400">{icon}</div> : null}
			<p className="text-lg font-semibold text-slate-900">{title}</p>
			{description ? (
				<p className="mt-2 max-w-md text-sm text-slate-500 leading-relaxed">
					{description}
				</p>
			) : null}
			{actions ? <div className="mt-6 flex gap-2">{actions}</div> : null}
		</div>
	);
}
