import { AlertCircle, Loader2 } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
	return (
		<div
			role="status"
			aria-live="polite"
			aria-busy="true"
			className="flex items-center gap-3 text-slate-500 p-8 justify-center dark:text-slate-400"
		>
			<Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
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
		<div
			role="alert"
			className="flex flex-col items-center gap-3 p-8 text-center"
		>
			<AlertCircle className="h-8 w-8 text-red-500" aria-hidden="true" />
			<div>
				<p className="text-sm font-medium text-slate-900 dark:text-slate-100">
					{title}
				</p>
				<p className="text-sm text-slate-500 mt-1 dark:text-slate-400">
					{message}
				</p>
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
				"flex flex-col items-center justify-center text-center rounded-lg border border-dashed border-[#c6c6c6] bg-white/80 p-12 dark:border-slate-700 dark:bg-slate-900/80",
				className,
			)}
		>
			{icon ? (
				<div
					className="mb-4 text-slate-400 dark:text-slate-500"
					aria-hidden="true"
				>
					{icon}
				</div>
			) : null}
			<p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
				{title}
			</p>
			{description ? (
				<p className="mt-2 max-w-md text-sm text-slate-500 leading-relaxed dark:text-slate-400">
					{description}
				</p>
			) : null}
			{actions ? <div className="mt-6 flex gap-2">{actions}</div> : null}
		</div>
	);
}

/**
 * Card-shaped shimmer placeholder for list pages (Workspaces, KB
 * Explorer, Agents, Chat). Renders `count` skeleton cards in a grid
 * matching the page layout. Use in place of {@link LoadingState} on
 * pages where the result is a list of cards — perceived perf is much
 * better than a centered spinner because the layout doesn't jump
 * when data arrives.
 */
export function SkeletonCard({
	className,
	count = 1,
	label = "Loading…",
}: {
	className?: string;
	count?: number;
	label?: string;
}) {
	const items = Array.from({ length: count }, (_, i) => i);
	return (
		<div
			role="status"
			aria-busy="true"
			aria-label={label}
			className={cn(
				"grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
				className,
			)}
		>
			<span className="sr-only">{label}</span>
			{items.map((i) => (
				<div
					key={i}
					className="animate-pulse rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
					aria-hidden="true"
				>
					<div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
					<div className="mt-3 h-3 w-1/2 rounded bg-slate-200/80 dark:bg-slate-700/80" />
					<div className="mt-6 flex gap-2">
						<div className="h-3 w-16 rounded bg-slate-200/60 dark:bg-slate-700/60" />
						<div className="h-3 w-12 rounded bg-slate-200/60 dark:bg-slate-700/60" />
					</div>
				</div>
			))}
		</div>
	);
}

/**
 * Row-shaped shimmer placeholder for table-style pages (Documents,
 * Agents detail, API keys). Same intent as {@link SkeletonCard} but
 * laid out as horizontal rows.
 */
export function SkeletonRow({
	count = 3,
	label = "Loading…",
}: {
	count?: number;
	label?: string;
}) {
	const items = Array.from({ length: count }, (_, i) => i);
	return (
		<div
			role="status"
			aria-busy="true"
			aria-label={label}
			className="space-y-2"
		>
			<span className="sr-only">{label}</span>
			{items.map((i) => (
				<div
					key={i}
					className="animate-pulse flex items-center gap-4 rounded-md border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
					aria-hidden="true"
				>
					<div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
					<div className="h-3 flex-1 rounded bg-slate-200/70 dark:bg-slate-700/70" />
					<div className="h-3 w-16 rounded bg-slate-200/60 dark:bg-slate-700/60" />
				</div>
			))}
		</div>
	);
}
