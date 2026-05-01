import { Bot } from "lucide-react";
import { Link } from "react-router-dom";
import type { AgentRecord } from "@/lib/schemas";

interface AgentPickerProps {
	agents: readonly AgentRecord[];
	activeAgentId: string;
	onSelect: (agentId: string) => void;
	workspaceId: string;
}

/**
 * Header row above the conversation surface. With one agent, just
 * shows the name; with two or more, renders a `<select>` so the
 * operator can switch agents in place. Always links to the dedicated
 * `/agents` page for full agent management.
 */
export function AgentPicker({
	agents,
	activeAgentId,
	onSelect,
	workspaceId,
}: AgentPickerProps) {
	const manageLink = (
		<Link
			to={`/workspaces/${workspaceId}/agents`}
			className="ml-auto text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
		>
			Manage agents
		</Link>
	);
	if (agents.length <= 1) {
		const only = agents[0];
		if (!only) return null;
		return (
			<div className="flex items-center gap-2 text-sm text-slate-700">
				<Bot
					className="h-4 w-4 text-[var(--color-brand-600)]"
					aria-hidden="true"
				/>
				<span className="font-medium">{only.name}</span>
				{manageLink}
			</div>
		);
	}
	return (
		<div className="flex items-center gap-2 text-sm text-slate-700">
			<Bot
				className="h-4 w-4 text-[var(--color-brand-600)]"
				aria-hidden="true"
			/>
			<label className="flex items-center gap-2">
				<span className="font-medium">Agent</span>
				<select
					value={activeAgentId}
					onChange={(e) => onSelect(e.target.value)}
					className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-[var(--color-brand-600)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-100)]"
					data-testid="agent-picker"
				>
					{agents.map((agent) => (
						<option key={agent.agentId} value={agent.agentId}>
							{agent.name}
						</option>
					))}
				</select>
			</label>
			{manageLink}
		</div>
	);
}
