import type * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: TextareaProps) {
	return (
		<textarea
			className={cn(
				"flex min-h-[96px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors",
				"placeholder:text-slate-400",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-0 focus-visible:border-[var(--color-brand-500)]",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus-visible:ring-red-500",
				className,
			)}
			{...props}
		/>
	);
}
