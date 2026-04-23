import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap",
	{
		variants: {
			variant: {
				primary: "bg-zinc-900 text-white hover:bg-zinc-800 active:bg-zinc-950",
				secondary:
					"bg-white text-zinc-900 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50",
				ghost: "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900",
				destructive: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
				brand:
					"bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-700)]",
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

export { buttonVariants };
