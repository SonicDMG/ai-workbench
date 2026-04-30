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
 * copy button. The base URL must come from the runtime's `/features`
 * payload — `window.location.origin` is wrong in dev (Vite proxy
 * redirects browser traffic but external MCP clients don't use the
 * proxy) and behind any TLS-terminating load balancer. The caller is
 * also responsible for hiding this button when MCP is disabled.
 */
export function McpUrlButton({
	workspaceId,
	baseUrl,
}: {
	workspaceId: string;
	baseUrl: string;
}) {
	const [open, setOpen] = useState(false);
	const url = `${baseUrl}/api/v1/workspaces/${workspaceId}/mcp`;

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
					<div className="flex items-start gap-2 rounded-md border bg-slate-50 px-3 py-2">
						<code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-slate-800">
							{url}
						</code>
						<CopyButton value={url} label="Copy MCP URL" className="shrink-0" />
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
