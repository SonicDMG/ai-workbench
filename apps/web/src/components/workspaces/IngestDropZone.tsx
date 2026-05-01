import { FolderOpen, Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { READABLE_TEXT_EXTENSIONS } from "@/lib/files";
import { cn } from "@/lib/utils";

/**
 * Drop zone + file/folder pickers for the ingest queue. Pure
 * presentational shell — `onFiles` receives every accepted FileList
 * and the parent decides what to enqueue. The `disabled` prop locks
 * down all input affordances while the queue is draining.
 */
export function IngestDropZone({
	maxBytes,
	disabled,
	onFiles,
}: {
	maxBytes: number;
	disabled: boolean;
	onFiles: (files: FileList | File[]) => void;
}) {
	const [dragActive, setDragActive] = useState(false);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const folderInputRef = useRef<HTMLInputElement | null>(null);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: drop zone is a pointer affordance; keyboard users get the in-zone "browse" + "folder" buttons.
		<div
			onDragOver={(e) => {
				if (disabled) return;
				e.preventDefault();
				setDragActive(true);
			}}
			onDragLeave={() => setDragActive(false)}
			onDrop={(e) => {
				if (disabled) return;
				e.preventDefault();
				setDragActive(false);
				if (e.dataTransfer.files.length > 0) {
					onFiles(e.dataTransfer.files);
				}
			}}
			className={cn(
				"flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-5 text-sm transition-colors",
				dragActive
					? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
					: "border-slate-300 bg-slate-50",
				disabled && "opacity-60",
			)}
		>
			<input
				ref={fileInputRef}
				type="file"
				multiple
				accept={READABLE_TEXT_EXTENSIONS.join(",")}
				className="hidden"
				onChange={(e) => {
					if (e.target.files) onFiles(e.target.files);
					e.target.value = "";
				}}
			/>
			<input
				ref={folderInputRef}
				type="file"
				multiple
				className="hidden"
				// webkitdirectory is the cross-browser folder picker. Not
				// in stock React HTMLAttributes; cast escape hatch.
				{...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
				onChange={(e) => {
					if (e.target.files) onFiles(e.target.files);
					e.target.value = "";
				}}
			/>

			<Upload className="h-5 w-5 text-slate-400" aria-hidden />
			<p className="text-slate-700">
				Drop files or a folder, or use a button below.
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => fileInputRef.current?.click()}
					disabled={disabled}
				>
					<Plus className="h-4 w-4" /> Files…
				</Button>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => folderInputRef.current?.click()}
					disabled={disabled}
				>
					<FolderOpen className="h-4 w-4" /> Folder…
				</Button>
			</div>
			<p className="text-xs text-slate-500">
				Text, Markdown, YAML, JSON, CSV, config, and source files up to{" "}
				{maxBytes / 1024 / 1024} MB each.
			</p>
		</div>
	);
}
