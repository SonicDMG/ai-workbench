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
					"bg-white text-[#161616] ring-1 ring-inset ring-[#8d8d8d] hover:bg-[#f4f4f4] shadow-sm",
				ghost: "text-[#525252] hover:bg-[#e0e0e0] hover:text-[#161616]",
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

export { buttonVariants };
