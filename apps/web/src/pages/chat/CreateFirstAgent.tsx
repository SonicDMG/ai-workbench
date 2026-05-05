import { ArrowLeft, ArrowRight, Bot, Plus, Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { AgentTemplateGallery } from "@/components/agents/AgentTemplateGallery";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldHelp } from "@/components/ui/field-label";
import { useCreateAgent } from "@/hooks/useConversations";
import { formatApiError } from "@/lib/api";

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
 * full control over name + system prompt.
 *
 * The custom form path is the historical zero-state surface — its
 * behavior + tests are unchanged; only its placement moved behind
 * a toggle.
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
						<h2 className="text-base font-semibold text-slate-900">
							Pick an agent to start with
						</h2>
						<p className="text-xs text-slate-500">
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
 * Hand-built agent form. Captures a name (required) + an optional
 * system prompt and creates the agent before handing the new id to
 * `onCreated` so the parent can switch to it.
 *
 * Exported so existing tests that drove the historical zero-state
 * form by typing into its inputs keep working without going through
 * the gallery toggle.
 */
export function CustomAgentForm({
	workspaceId,
	onCreated,
	onBack,
}: CustomAgentFormProps) {
	const create = useCreateAgent(workspaceId);
	const [name, setName] = useState("");
	const [systemPrompt, setSystemPrompt] = useState("");

	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const trimmedName = name.trim();
		if (trimmedName.length === 0) return;
		try {
			const agent = await create.mutateAsync({
				name: trimmedName,
				systemPrompt: systemPrompt.trim() ? systemPrompt.trim() : null,
			});
			toast.success(`Agent '${agent.name}' created`);
			onCreated(agent.agentId);
		} catch (err) {
			toast.error("Couldn't create agent", {
				description: formatApiError(err),
			});
		}
	};

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
						<h2 className="text-base font-semibold text-slate-900">
							Create your first agent
						</h2>
						<p className="text-xs text-slate-500">
							An agent owns its conversations, system prompt, and (later)
							knowledge bases.
						</p>
					</div>
					{onBack ? (
						<Button variant="ghost" size="sm" onClick={onBack}>
							<ArrowLeft className="h-4 w-4" />
							Templates
						</Button>
					) : null}
				</div>
				<form
					onSubmit={onSubmit}
					className="flex flex-col gap-3"
					aria-label="Create agent"
				>
					<div className="flex flex-col gap-1 text-sm">
						<div className="flex items-center gap-1.5 font-medium text-slate-700">
							<label htmlFor="custom-agent-name">Name</label>
							<FieldHelp help="Shown in agent pickers and conversation history. Pick something memorable — you can rename it later." />
						</div>
						<input
							id="custom-agent-name"
							type="text"
							required
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Bobby"
							className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[var(--color-brand-600)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-100)]"
						/>
					</div>
					<div className="flex flex-col gap-1 text-sm">
						<div className="flex items-center gap-1.5 font-medium text-slate-700">
							<label htmlFor="custom-agent-system-prompt">
								System prompt{" "}
								<span className="font-normal text-slate-400">(optional)</span>
							</label>
							<FieldHelp help="The persona / instructions injected at the top of every conversation. Leave it blank to fall back to the runtime's default helpful-assistant prompt." />
						</div>
						<textarea
							id="custom-agent-system-prompt"
							rows={3}
							value={systemPrompt}
							onChange={(e) => setSystemPrompt(e.target.value)}
							placeholder="You are a helpful assistant grounded in this workspace."
							className="resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[var(--color-brand-600)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-100)]"
						/>
					</div>
					<div className="flex justify-end">
						<Button
							type="submit"
							variant="brand"
							disabled={create.isPending || name.trim().length === 0}
						>
							<Plus className="h-4 w-4" />
							{create.isPending ? "Creating…" : "Create agent"}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
