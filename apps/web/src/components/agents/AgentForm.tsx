import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { FieldHelp, FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
	AgentRecord,
	AvailableTool,
	CreateAgentInput,
	KnowledgeBaseRecord,
	LlmServiceRecord,
	RerankingServiceRecord,
	ToolSource,
	UpdateAgentInput,
} from "@/lib/schemas";

/**
 * Form schema. Pickers / text inputs land here; the submit handler
 * builds the API payload — converting empty pickers to `null` for
 * nullable foreign keys, parsing numbers from strings.
 */
const FormSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string(),
	systemPrompt: z.string(),
	llmServiceId: z.string(),
	knowledgeBaseIds: z.array(z.string().uuid()),
	// Per-agent tool allow-list. Empty = all built-in tools (default).
	toolIds: z.array(z.string()),
	rerankEnabled: z.boolean(),
	rerankingServiceId: z.string(),
	rerankMaxResults: z.string(),
});
type FormInput = z.infer<typeof FormSchema>;

const NONE_VALUE = "__none__";

/** Human-friendly group label per tool source. */
const TOOL_SOURCE_LABEL: Record<ToolSource, string> = {
	builtin: "Built-in workspace tools",
	native: "Native tools",
	astra: "Astra Data API",
	mcp: "External MCP servers",
};

const TOOL_SOURCE_ORDER: readonly ToolSource[] = [
	"builtin",
	"native",
	"astra",
	"mcp",
];

function toFormDefaults(agent: AgentRecord | null): FormInput {
	return {
		name: agent?.name ?? "",
		description: agent?.description ?? "",
		systemPrompt: agent?.systemPrompt ?? "",
		llmServiceId: agent?.llmServiceId ?? "",
		knowledgeBaseIds: agent?.knowledgeBaseIds ?? [],
		toolIds: agent?.toolIds ?? [],
		rerankEnabled: agent?.rerankEnabled ?? false,
		rerankingServiceId: agent?.rerankingServiceId ?? "",
		rerankMaxResults: agent?.rerankMaxResults?.toString() ?? "",
	};
}

function parseOptionalInt(value: string): number | null {
	if (value.trim() === "") return null;
	const n = Number.parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function buildPayload(values: FormInput): CreateAgentInput {
	return {
		name: values.name.trim(),
		description: values.description.trim() || null,
		systemPrompt: values.systemPrompt.trim() || null,
		llmServiceId: values.llmServiceId || null,
		knowledgeBaseIds: values.knowledgeBaseIds,
		// Empty selection → omit, so the backend grandfathers all built-in
		// tools (the "default" semantics). A non-empty set is sent verbatim.
		toolIds: values.toolIds,
		rerankEnabled: values.rerankEnabled,
		rerankingServiceId: values.rerankingServiceId || null,
		rerankMaxResults: parseOptionalInt(values.rerankMaxResults),
	};
}

/** Group the flat tool catalog by source, preserving a stable order. */
function groupToolsBySource(
	tools: readonly AvailableTool[],
): readonly { source: ToolSource; tools: readonly AvailableTool[] }[] {
	return TOOL_SOURCE_ORDER.map((source) => ({
		source,
		tools: tools.filter((t) => t.source === source),
	})).filter((g) => g.tools.length > 0);
}

export interface AgentFormProps {
	readonly mode: "create" | "edit";
	readonly agent?: AgentRecord | null;
	readonly knowledgeBases: readonly KnowledgeBaseRecord[];
	readonly llmServices: readonly LlmServiceRecord[];
	readonly rerankingServices: readonly RerankingServiceRecord[];
	/**
	 * Workspace id. When provided, the Tools section links to the
	 * MCP/tool settings so operators can register more tools without
	 * leaving the form.
	 */
	readonly workspaceId?: string;
	/**
	 * Selectable tool catalog for this workspace (from
	 * `GET .../available-tools`). When omitted/empty the tool picker is
	 * hidden — the agent keeps the default "all built-in tools" behavior.
	 */
	readonly availableTools?: readonly AvailableTool[];
	readonly submitting?: boolean;
	readonly onSubmit: (
		values: CreateAgentInput | UpdateAgentInput,
	) => Promise<void> | void;
	readonly onCancel?: () => void;
}

export function AgentForm({
	mode,
	agent,
	knowledgeBases,
	llmServices,
	rerankingServices,
	workspaceId,
	availableTools = [],
	submitting,
	onSubmit,
	onCancel,
}: AgentFormProps) {
	const form = useForm<FormInput>({
		resolver: zodResolver(FormSchema),
		defaultValues: toFormDefaults(agent ?? null),
	});

	const rerankEnabled = form.watch("rerankEnabled");
	const selectedKbIds = form.watch("knowledgeBaseIds");
	const selectedToolIds = form.watch("toolIds");
	const errors = form.formState.errors;
	const toolGroups = groupToolsBySource(availableTools);
	const hasExternalTools = toolGroups.some((g) => g.source !== "builtin");

	function toggleKb(kbId: string): void {
		const current = form.getValues("knowledgeBaseIds");
		const next = current.includes(kbId)
			? current.filter((id) => id !== kbId)
			: [...current, kbId];
		form.setValue("knowledgeBaseIds", next, { shouldDirty: true });
	}

	function toggleTool(toolId: string): void {
		const current = form.getValues("toolIds");
		const next = current.includes(toolId)
			? current.filter((id) => id !== toolId)
			: [...current, toolId];
		form.setValue("toolIds", next, { shouldDirty: true });
	}

	async function handleSubmit(values: FormInput): Promise<void> {
		await onSubmit(buildPayload(values));
	}

	return (
		<form
			onSubmit={form.handleSubmit(handleSubmit)}
			className="flex flex-col gap-5"
		>
			<div className="flex flex-col gap-1.5">
				<FieldLabel
					htmlFor="agent-name"
					help="A human-friendly label. Shown in agent lists and conversation history."
				>
					Name
				</FieldLabel>
				<Input
					id="agent-name"
					placeholder="e.g. Support assistant"
					autoFocus
					aria-invalid={errors.name ? true : undefined}
					{...form.register("name")}
				/>
				{errors.name ? (
					<p className="text-xs text-red-600 dark:text-red-400">
						{errors.name.message}
					</p>
				) : null}
			</div>

			<div className="flex flex-col gap-1.5">
				<FieldLabel
					htmlFor="agent-description"
					help="Optional context for teammates. Doesn't affect agent behavior."
				>
					Description (optional)
				</FieldLabel>
				<Input
					id="agent-description"
					placeholder="What does this agent help with?"
					{...form.register("description")}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<FieldLabel
					htmlFor="agent-system-prompt"
					help="Persona / instructions injected at the top of every conversation. Leave blank to use the runtime default."
				>
					System prompt (optional)
				</FieldLabel>
				<Textarea
					id="agent-system-prompt"
					rows={5}
					placeholder="You are a helpful assistant grounded in the workspace's knowledge bases…"
					{...form.register("systemPrompt")}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<FieldLabel
					htmlFor="agent-llm-service"
					help="Optional. Pick a workspace-scoped LLM service to override the runtime's global chat config. Leave unset to fall back to the global service."
				>
					LLM service (optional)
				</FieldLabel>
				<Controller
					name="llmServiceId"
					control={form.control}
					render={({ field }) => (
						<Select
							value={field.value || NONE_VALUE}
							onValueChange={(v) => field.onChange(v === NONE_VALUE ? "" : v)}
						>
							<SelectTrigger id="agent-llm-service">
								<SelectValue placeholder="Use runtime default" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={NONE_VALUE}>Use runtime default</SelectItem>
								{llmServices.map((svc) => (
									<SelectItem key={svc.llmServiceId} value={svc.llmServiceId}>
										{svc.name} — {svc.provider}/{svc.modelName}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<FieldLabel
					className="text-sm font-medium"
					help="The KBs this agent grounds on by default. A conversation can override the set, but the agent's defaults are what new conversations inherit. Leave every box unchecked to draw from every KB in the workspace."
				>
					Knowledge base bindings
				</FieldLabel>
				<p className="text-xs text-slate-500 dark:text-slate-400">
					Default RAG scope for conversations against this agent. Leave empty to
					use the default — every knowledge base in the workspace.
				</p>
				{knowledgeBases.length === 0 ? (
					<p className="text-xs text-slate-500 italic dark:text-slate-400">
						No knowledge bases in this workspace yet.
					</p>
				) : (
					<div className="flex flex-col gap-1.5">
						{knowledgeBases.map((kb) => {
							const checked = selectedKbIds.includes(kb.knowledgeBaseId);
							return (
								<label
									key={kb.knowledgeBaseId}
									className="flex items-center gap-2 text-sm"
								>
									<input
										type="checkbox"
										checked={checked}
										onChange={() => toggleKb(kb.knowledgeBaseId)}
										className="h-4 w-4 rounded border-slate-300 text-[var(--color-brand-500)] focus:ring-[var(--color-brand-500)] dark:border-slate-600 dark:bg-slate-900"
									/>
									<span className="font-medium">{kb.name}</span>
									{kb.description ? (
										<span className="text-slate-500 text-xs dark:text-slate-400">
											— {kb.description}
										</span>
									) : null}
								</label>
							);
						})}
					</div>
				)}
			</div>

			{toolGroups.length > 0 ? (
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center justify-between gap-2">
						<FieldLabel
							className="text-sm font-medium"
							help="The tools this agent may call mid-conversation. Leave every box unchecked to grandfather in all built-in workspace tools (the default). Checking any box switches to an explicit allow-list — only the checked tools are offered (built-in tools must then be checked too). Native and external-MCP tools are always opt-in."
						>
							Tools
						</FieldLabel>
						{workspaceId ? (
							<Button type="button" variant="ghost" size="sm" asChild>
								<Link to={`/workspaces/${workspaceId}/settings`}>
									<Plus className="h-3.5 w-3.5" />
									Add tools
								</Link>
							</Button>
						) : null}
					</div>
					<p className="text-xs text-slate-500 dark:text-slate-400">
						{selectedToolIds.length === 0
							? "Leave empty to use the default — all built-in workspace tools. Check tools to set an explicit allow-list."
							: `${selectedToolIds.length} tool${selectedToolIds.length === 1 ? "" : "s"} selected.`}
					</p>
					<div className="flex flex-col gap-3">
						{toolGroups.map((group) => (
							<fieldset
								key={group.source}
								className="flex flex-col gap-1.5"
								data-testid={`tool-group-${group.source}`}
							>
								<legend className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
									{TOOL_SOURCE_LABEL[group.source]}
								</legend>
								{group.tools.map((tool) => {
									const checked = selectedToolIds.includes(tool.id);
									return (
										<label
											key={tool.id}
											className="flex items-start gap-2 text-sm"
										>
											<input
												type="checkbox"
												checked={checked}
												onChange={() => toggleTool(tool.id)}
												className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[var(--color-brand-500)] focus:ring-[var(--color-brand-500)] dark:border-slate-600 dark:bg-slate-900"
											/>
											<span className="min-w-0">
												<span className="font-mono text-[13px] font-medium">
													{tool.id}
												</span>
												{tool.description ? (
													<span className="block text-xs text-slate-500 dark:text-slate-400">
														{tool.description}
													</span>
												) : null}
											</span>
										</label>
									);
								})}
							</fieldset>
						))}
						{!hasExternalTools ? (
							<div className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400">
								No external tools are registered for this workspace yet.{" "}
								{workspaceId ? (
									<Link
										to={`/workspaces/${workspaceId}/settings`}
										className="font-medium text-[var(--color-brand-600)] hover:underline"
									>
										Add an MCP server
									</Link>
								) : (
									"Add an MCP server"
								)}{" "}
								in Settings to give this agent more tools.
							</div>
						) : null}
					</div>
				</div>
			) : null}

			<fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
				<div className="flex items-center gap-2">
					<label className="flex items-center gap-2 text-sm font-medium">
						<input
							type="checkbox"
							{...form.register("rerankEnabled")}
							className="h-4 w-4 rounded border-slate-300 text-[var(--color-brand-500)] focus:ring-[var(--color-brand-500)] dark:border-slate-600 dark:bg-slate-900"
						/>
						Enable reranking
					</label>
					<FieldHelp help="Runs a second-pass model over vector-search hits to reorder them by relevance. Adds latency and cost — leave off for cheap KB lookups, turn on when precision matters more than throughput." />
				</div>
				{rerankEnabled ? (
					<div className="grid grid-cols-2 gap-3 pl-6">
						<div className="flex flex-col gap-1.5">
							<FieldLabel
								htmlFor="agent-rerank-service"
								help="Pick a reranking service. Leave unset to use the KB's default."
							>
								Reranking service
							</FieldLabel>
							<Controller
								name="rerankingServiceId"
								control={form.control}
								render={({ field }) => (
									<Select
										value={field.value || NONE_VALUE}
										onValueChange={(v) =>
											field.onChange(v === NONE_VALUE ? "" : v)
										}
									>
										<SelectTrigger id="agent-rerank-service">
											<SelectValue placeholder="Use KB default" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value={NONE_VALUE}>Use KB default</SelectItem>
											{rerankingServices.map((svc) => (
												<SelectItem
													key={svc.rerankingServiceId}
													value={svc.rerankingServiceId}
												>
													{svc.name} — {svc.provider}/{svc.modelName}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								)}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<FieldLabel
								htmlFor="agent-rerank-max"
								help="Optional. Max reranked results."
							>
								Max reranked results
							</FieldLabel>
							<Input
								id="agent-rerank-max"
								type="number"
								min={1}
								placeholder="e.g. 5"
								{...form.register("rerankMaxResults")}
							/>
						</div>
					</div>
				) : null}
			</fieldset>

			<div className="flex justify-end gap-2 pt-2">
				{onCancel ? (
					<Button
						type="button"
						variant="ghost"
						onClick={onCancel}
						disabled={submitting}
					>
						Cancel
					</Button>
				) : null}
				<Button type="submit" disabled={submitting}>
					{submitting
						? "Saving…"
						: mode === "create"
							? "Create agent"
							: "Save changes"}
				</Button>
			</div>
		</form>
	);
}
