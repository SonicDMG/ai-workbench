import { extOf, fileTypeMeta } from "@/lib/files";
import { cn } from "@/lib/utils";

/**
 * Compact uppercase badge for a document's file type. Reads the
 * extension off `sourceFilename` (or falls back to a `fileType`
 * mime-ish string) and looks up the badge color via
 * {@link fileTypeMeta}. Unknown extensions get a slate fallback so
 * the column never shows a missing pill.
 */
export function FileTypeBadge({
	sourceFilename,
	fileType,
	className,
}: {
	sourceFilename?: string | null;
	fileType?: string | null;
	className?: string;
}) {
	// Prefer the filename — it's the operator's intent, the
	// browser-reported MIME (`application/octet-stream`, etc.) is
	// fuzzy.
	const fromName = extOf(sourceFilename);
	const fromType = fileType ? extOf(`.${fileType.split("/").pop() ?? ""}`) : "";
	const ext = fromName || fromType;
	const meta = fileTypeMeta(ext);
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
				meta.badgeClass,
				className,
			)}
			title={ext ? `.${ext}` : "unknown extension"}
		>
			{meta.label}
		</span>
	);
}
