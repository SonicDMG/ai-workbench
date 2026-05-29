import { ArrowLeft, ArrowRight, Bot, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AgentForm } from "@/components/agents/AgentForm";
import { AgentTemplateGallery } from "@/components/agents/AgentTemplateGallery";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	useAvailableTools,
	useCreateAgent,
	useLlmServices,
} from "@/hooks/useConversations";
import { useKnowledgeBases } from "@/hooks/useKnowledgeBases";
import { useRerankingServices } from "@/hooks/useServices";
import { formatApiError } from "@/lib/api";
import type { CreateAgentInput } from "@/lib/schemas";

interface CreateFirstAgentProps {
	workspaceId: string;
	onCreated: (agentId: string) => void;
}

type View = "gallery" | "custom";

/**
 * Empty-state shown to operators landing on Chat in a workspace with
 * zero agents. Defaults to the {@link AgentTemplateGallery} so a user
 * who deleted everything (or whose seed step failed) can re-add one
 * of the standard personas in a single click. A "Create my own"
 * affordance toggles to {@link CustomAgentForm} for users who want
 * full control over the agent's persona, knowledge bases, and tools.
 */
export function CreateFirstAgent({
	workspaceId,
	onCreated,
}: CreateFirstAgentProps) {
	const [view, setView] = useState<View>("gallery");

	if (view === "custom") {
		return (
			<CustomAgentForm
				workspaceId={workspaceId}
				onCreated={onCreated}
				onBack={() => setView("gallery")}
			/>
		);
	}

	return (
		<Card>
			<CardContent className="flex flex-col gap-4 p-6">
				<div className="flex items-center gap-3">
					<div className="rounded-full bg-[var(--color-brand-50)] p-2">
						<Sparkles
							className="h-5 w-5 text-[var(--color-brand-600)]"
							aria-hidden="true"
						/>
					</div>
					<div>
						<h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
							Pick an agent to start with
						</h2>
						<p className="text-xs text-slate-500 dark:text-slate-400">
							Templates ship with a tuned persona and tool-use guidance. Click
							Add to drop one into this workspace.
						</p>
					</div>
				</div>
				<AgentTemplateGallery
					workspaceId={workspaceId}
					onAdded={(agent) => onCreated(agent.agentId)}
				/>
				<div className="flex justify-end pt-1">
					<Button variant="ghost" size="sm" onClick={() => setView("custom")}>
						Or build a custom agent
						<ArrowRight className="h-4 w-4" />
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

interface CustomAgentFormProps {
	workspaceId: string;
	onCreated: (agentId: string) => void;
	onBack?: () => void;
}

/**
 * Custom agent builder for the chat zero-state. Renders the shared
 * {@link AgentForm} inline (the same form used by the workspace
 * overview and the Agents page) so first-time users get the full
 * experience — name, system prompt, knowledge bases, LLM binding,
 * tools, and reranking — rather than a stripped-down fork. On success
 * it hands the new agent id to `onCreated` so the parent can switch
 * the chat to it.
 *
 * Exported so the chat zero-state tests can drive the custom path
 * directly without toggling through the gallery.
 */
export function CustomAgentForm({
	workspaceId,
	onCreated,
	onBack,
}: CustomAgentFormProps) {
	const create = useCreateAgent(workspaceId);
	const knowledgeBases = useKnowledgeBases(workspaceId);
	const llmServices = useLlmServices(workspaceId);
	const rerankingServices = useRerankingServices(workspaceId);
	const availableTools = useAvailableTools(workspaceId);

	return (
		<Card>
			<CardContent className="flex flex-col gap-4 p-6">
				<div className="flex items-center gap-3">
					<div className="rounded-full bg-[var(--color-brand-50)] p-2">
						<Bot
							className="h-5 w-5 text-[var(--color-brand-600)]"
							aria-hidden="true"
						/>
					</div>
					<div className="min-w-0 flex-1">
						<h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
							Create your first agent
						</h2>
						<p className="text-xs text-slate-500 dark:text-slate-400">
							An agent owns its conversations, system prompt, knowledge bases,
							and tools.
						</p>
					</div>
					{onBack ? (
						<Button variant="ghost" size="sm" onClick={onBack}>
							<ArrowLeft className="h-4 w-4" />
							Templates
						</Button>
					) : null}
				</div>
				<AgentForm
					mode="create"
					workspaceId={workspaceId}
					knowledgeBases={knowledgeBases.data ?? []}
					llmServices={llmServices.data ?? []}
					rerankingServices={rerankingServices.data ?? []}
					availableTools={availableTools.data ?? []}
					submitting={create.isPending}
					onSubmit={async (values) => {
						try {
							const agent = await create.mutateAsync(
								values as CreateAgentInput,
							);
							toast.success(`Agent '${agent.name}' created`);
							onCreated(agent.agentId);
						} catch (err) {
							toast.error("Couldn't create agent", {
								description: formatApiError(err),
							});
						}
					}}
					onCancel={onBack}
				/>
			</CardContent>
		</Card>
	);
}
