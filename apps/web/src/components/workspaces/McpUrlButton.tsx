import { Plug } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/common/CopyButton";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

/**
 * Action-row button that surfaces the workspace's MCP endpoint.
 *
 * Clicking opens a small dialog displaying the absolute URL plus a
 * copy button. The caller is responsible for hiding this button when
 * MCP is disabled — gate on the runtime's `/features` flag (see
 * {@link ../../hooks/useFeatures.useFeatures}).
 */
export function McpUrlButton({ workspaceId }: { workspaceId: string }) {
	const [open, setOpen] = useState(false);
	const url =
		typeof window !== "undefined"
			? `${window.location.origin}/api/v1/workspaces/${workspaceId}/mcp`
			: `/api/v1/workspaces/${workspaceId}/mcp`;

	return (
		<>
			<Button variant="secondary" onClick={() => setOpen(true)}>
				<Plug className="h-4 w-4" />
				MCP
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>MCP endpoint</DialogTitle>
						<DialogDescription>
							Point any Model Context Protocol client (Claude Code, Cursor,
							Goose, …) at this URL to give it access to this workspace's
							knowledge bases and tools.
						</DialogDescription>
					</DialogHeader>
					<div className="flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-2">
						<code className="flex-1 truncate font-mono text-xs text-slate-800">
							{url}
						</code>
						<CopyButton value={url} label="Copy MCP URL" />
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setOpen(false)}>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
