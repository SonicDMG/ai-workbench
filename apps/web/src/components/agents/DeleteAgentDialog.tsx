import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteAgent } from "@/hooks/useConversations";
import { formatApiError } from "@/lib/api";
import type { AgentRecord } from "@/lib/schemas";

interface DeleteAgentDialogProps {
	readonly workspace: string;
	/** The agent to delete. `null` keeps the dialog closed. */
	readonly agent: AgentRecord | null;
	readonly onClose: () => void;
}

/**
 * Confirm + delete an agent (and its conversations). Shared by the
 * workspace overview and the dedicated Agents page.
 */
export function DeleteAgentDialog({
	workspace,
	agent,
	onClose,
}: DeleteAgentDialogProps) {
	const del = useDeleteAgent(workspace);
	if (!agent) return null;
	return (
		<Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete this agent?</DialogTitle>
					<DialogDescription>
						<strong>{agent.name}</strong> will be deleted along with all of its
						conversations and message history. This cannot be undone.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose} disabled={del.isPending}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						disabled={del.isPending}
						onClick={async () => {
							try {
								await del.mutateAsync(agent.agentId);
								toast.success("Agent deleted");
								onClose();
							} catch (err) {
								toast.error("Couldn't delete agent", {
									description: formatApiError(err),
								});
							}
						}}
					>
						{del.isPending ? "Deleting…" : "Delete agent"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
