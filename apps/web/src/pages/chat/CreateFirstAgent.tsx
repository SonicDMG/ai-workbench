import { Bot, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCreateAgent } from "@/hooks/useConversations";
import { formatApiError } from "@/lib/api";

interface CreateFirstAgentProps {
	workspaceId: string;
	onCreated: (agentId: string) => void;
}

/**
 * Inline empty-state shown to operators landing on Chat in a workspace
 * with zero agents. Captures a name (required) + an optional system
 * prompt and creates the agent before handing the new id to
 * `onCreated` so the parent can switch to it.
 */
export function CreateFirstAgent({
	workspaceId,
	onCreated,
}: CreateFirstAgentProps) {
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
					<div>
						<h2 className="text-base font-semibold text-slate-900">
							Create your first agent
						</h2>
						<p className="text-xs text-slate-500">
							An agent owns its conversations, system prompt, and (later)
							knowledge bases.
						</p>
					</div>
				</div>
				<form
					onSubmit={onSubmit}
					className="flex flex-col gap-3"
					aria-label="Create agent"
				>
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium text-slate-700">Name</span>
						<input
							type="text"
							required
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Bobbie"
							className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[var(--color-brand-600)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-100)]"
						/>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium text-slate-700">
							System prompt{" "}
							<span className="font-normal text-slate-400">(optional)</span>
						</span>
						<textarea
							rows={3}
							value={systemPrompt}
							onChange={(e) => setSystemPrompt(e.target.value)}
							placeholder="You are a helpful assistant grounded in this workspace."
							className="resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[var(--color-brand-600)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-100)]"
						/>
					</label>
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
