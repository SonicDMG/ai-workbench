import { cn } from "@/lib/utils";

/**
 * AI Workbench brand mark — a four-point star on a gradient tile.
 * Matches the favicon; use wherever the app needs a recognizable
 * identity stamp (header, onboarding hero, empty states).
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
	const id = `astra-mark-${size}`;
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
			<defs>
				<linearGradient
					id={id}
					x1="0"
					y1="0"
					x2="32"
					y2="32"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset="0%" stopColor="#3A36DB" />
					<stop offset="55%" stopColor="#5B4FE9" />
					<stop offset="100%" stopColor="#22C8BF" />
				</linearGradient>
			</defs>
			<rect width="32" height="32" rx="7" fill={`url(#${id})`} />
			<path
				d="M16 6L18.5 13.5L26 16L18.5 18.5L16 26L13.5 18.5L6 16L13.5 13.5Z"
				fill="white"
				fillOpacity="0.95"
			/>
		</svg>
	);
}
