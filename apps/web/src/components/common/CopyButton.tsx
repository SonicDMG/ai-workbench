import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One-click clipboard copy for short strings (IDs, SecretRefs,
 * endpoints). Flashes a check icon for 1.5s so there's no toast
 * spam on rapid copy-paste workflows.
 */
export function CopyButton({
	value,
	label,
	className,
}: {
	value: string;
	/** Accessible label, e.g. "Copy workspace workspaceId". */
	label: string;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);

	async function doCopy() {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard write can fail in insecure contexts or when permission
			// is denied. Fail silently — the UI still shows the value the user
			// can select by hand.
		}
	}

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			onClick={doCopy}
			aria-label={copied ? `${label} — copied` : label}
			title={copied ? "Copied!" : label}
			className={cn("h-7 w-7", className)}
		>
			{copied ? (
				<Check className="h-3.5 w-3.5 text-emerald-600" />
			) : (
				<Copy className="h-3.5 w-3.5" />
			)}
		</Button>
	);
}
