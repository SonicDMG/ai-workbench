import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectLabel({
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
	return (
		<SelectPrimitive.Label
			className={cn(
				"px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500",
				className,
			)}
			{...props}
		/>
	);
}

export function SelectTrigger({
	className,
	children,
	...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) {
	return (
		<SelectPrimitive.Trigger
			className={cn(
				"flex h-9 w-full min-w-0 items-center justify-between overflow-hidden rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100",
				"focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:border-[var(--color-brand-500)]",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"[&>span:first-child]:min-w-0 [&>span:first-child]:truncate",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

export function SelectContent({
	className,
	children,
	...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				position="popper"
				sideOffset={4}
				className={cn(
					"relative z-50 min-w-[8rem] overflow-hidden rounded-md border border-slate-200 bg-white text-slate-900 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.25)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
					"data-[state=open]:animate-wb-fade-in",
					className,
				)}
				{...props}
			>
				{/* Cap the height so large catalogs (e.g. 300+ OpenRouter
				    models) scroll inside a compact box instead of a wall. */}
				<SelectPrimitive.Viewport className="max-h-72 overflow-y-auto p-1">
					{children}
				</SelectPrimitive.Viewport>
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
}

export function SelectItem({
	className,
	children,
	...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
	return (
		<SelectPrimitive.Item
			className={cn(
				"relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none",
				"focus:bg-slate-100 focus:text-slate-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-slate-800 dark:focus:text-slate-100",
				className,
			)}
			{...props}
		>
			<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<Check className="h-4 w-4" />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}
