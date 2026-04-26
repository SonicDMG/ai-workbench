import { cn } from "@/lib/utils";

/**
 * AI Workbench brand mark — a square Carbon-blue tile with a simple
 * data/workbench motif. It nods to IBM geometry without recreating
 * IBM's trademarked striped logotype.
 */
export function BrandMark({
	className,
	size = 32,
	title = "AI Workbench",
}: {
	className?: string;
	size?: number;
	/** Accessible label; defaults to "AI Workbench". */
	title?: string;
}) {
	return (
		<svg
			viewBox="0 0 32 32"
			width={size}
			height={size}
			fill="none"
			role="img"
			className={cn("shrink-0", className)}
		>
			<title>{title}</title>
			<rect width="32" height="32" fill="#0F62FE" />
			<path d="M0 24h32v8H0z" fill="#001D6C" opacity="0.9" />
			<path d="M8 8h16v2H8zM8 13h16v2H8zM8 18h10v2H8z" fill="white" />
			<path
				d="M22 18.5h2.8v2.8H22zM18 22.5h2.8v2.8H18zM26 22.5h2.8v2.8H26z"
				fill="#A6C8FF"
			/>
		</svg>
	);
}
