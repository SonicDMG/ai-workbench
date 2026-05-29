import { toast } from "sonner";
import { AgentForm } from "@/components/agents/AgentForm";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	useAvailableTools,
	useCreateAgent,
	useUpdateAgent,
} from "@/hooks/useConversations";
import { formatApiError } from "@/lib/api";
import type {
	AgentRecord,
	CreateAgentInput,
	KnowledgeBaseRecord,
	LlmServiceRecord,
	RerankingServiceRecord,
	UpdateAgentInput,
} from "@/lib/schemas";

interface AgentFormDialogProps {
	readonly workspace: string;
	readonly mode: "create" | "edit";
	/** The agent being edited. Required (non-null) when `mode === "edit"`. */
	readonly agent?: AgentRecord | null;
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly knowledgeBases: readonly KnowledgeBaseRecord[];
	readonly llmServices: readonly LlmServiceRecord[];
	readonly rerankingServices: readonly RerankingServiceRecord[];
	/** Create-mode callback so callers (e.g. chat) can switch to the new agent. */
	readonly onCreated?: (agent: AgentRecord) => void;
}

/**
 * The single create/edit agent dialog shared by every surface that
 * edits agents — the workspace overview, the dedicated Agents page, and
 * the chat zero-state. It owns the tool-catalog fetch
 * ({@link useAvailableTools}) and the create/update mutations, so no
 * call site can forget to wire the tool picker (the bug that previously
 * hid the Tools section on the workspace overview's agent dialogs).
 *
 * Rendering is gated on `open`; Radix unmounts the form on close, so
 * {@link AgentForm} re-seeds its defaults from `agent` on each open (the
 * form has no internal reset effect — it relies on remount). The `key`
 * forces a fresh mount when the edited agent changes.
 */
export function AgentFormDialog({
	workspace,
	mode,
	agent,
	open,
	onOpenChange,
	knowledgeBases,
	llmServices,
	rerankingServices,
	onCreated,
}: AgentFormDialogProps) {
	const availableTools = useAvailableTools(workspace);
	const create = useCreateAgent(workspace);
	const update = useUpdateAgent(workspace, agent?.agentId ?? "__missing__");

	const submitting = mode === "create" ? create.isPending : update.isPending;

	async function handleSubmit(
		values: CreateAgentInput | UpdateAgentInput,
	): Promise<void> {
		try {
			if (mode === "create") {
				const created = await create.mutateAsync(values as CreateAgentInput);
				toast.success("Agent created");
				onCreated?.(created);
			} else {
				await update.mutateAsync(values as UpdateAgentInput);
				toast.success("Agent updated");
			}
			onOpenChange(false);
		} catch (err) {
			toast.error(
				mode === "create" ? "Couldn't create agent" : "Couldn't save changes",
				{ description: formatApiError(err) },
			);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{mode === "create" ? "New agent" : "Edit agent"}
					</DialogTitle>
					<DialogDescription>
						{mode === "create"
							? "Define a workspace-scoped agent with its own persona, RAG defaults, and tools."
							: (agent?.name ?? "")}
					</DialogDescription>
				</DialogHeader>
				<AgentForm
					key={agent?.agentId ?? "new"}
					mode={mode}
					agent={agent ?? null}
					workspaceId={workspace}
					knowledgeBases={knowledgeBases}
					llmServices={llmServices}
					rerankingServices={rerankingServices}
					availableTools={availableTools.data ?? []}
					submitting={submitting}
					onSubmit={handleSubmit}
					onCancel={() => onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}
