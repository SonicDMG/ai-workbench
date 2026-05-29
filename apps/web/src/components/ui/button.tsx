import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap",
	{
		variants: {
			variant: {
				primary:
					"bg-[#262626] text-white hover:bg-[#393939] active:bg-[#161616] shadow-sm",
				secondary:
					"bg-white text-[#161616] ring-1 ring-inset ring-[#8d8d8d] hover:bg-[#f4f4f4] shadow-sm dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-600 dark:hover:bg-slate-800",
				ghost:
					"text-[#525252] hover:bg-[#e0e0e0] hover:text-[#161616] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
				destructive:
					"bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm",
				brand:
					"bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-900)] shadow-sm",
			},
			size: {
				sm: "h-8 px-3",
				md: "h-9 px-4",
				lg: "h-10 px-5 text-base",
				icon: "h-9 w-9",
			},
		},
		defaultVariants: { variant: "primary", size: "md" },
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

export function Button({
	className,
	variant,
	size,
	asChild,
	...props
}: ButtonProps) {
	const Comp = asChild ? Slot : "button";
	return (
		<Comp
			className={cn(buttonVariants({ variant, size }), className)}
			{...props}
		/>
	);
}

/**
 * Icon-only button that forces an accessible name at the type level.
 *
 * Icon-only controls have no visible text, so an `aria-label` is the
 * only thing screen-reader users have to go on. Plain `<Button
 * size="icon">` makes that label optional, which is exactly the gap
 * that lets unlabeled icon buttons slip through review. `IconButton`
 * closes it: `aria-label` is required (TS errors without it) and the
 * size is pinned to `"icon"` so callers can't accidentally widen it.
 *
 * Prefer this over `<Button size="icon">` for any new icon-only
 * affordance.
 */
export interface IconButtonProps extends Omit<ButtonProps, "size"> {
	"aria-label": string;
}

export function IconButton({ className, ...props }: IconButtonProps) {
	return <Button size="icon" className={className} {...props} />;
}

export { buttonVariants };
