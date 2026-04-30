import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
	CreateAgentInput,
	KnowledgeBaseRecord,
	LlmServiceRecord,
	RerankingServiceRecord,
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
	ragEnabled: z.boolean(),
	ragMaxResults: z.string(),
	ragMinScore: z.string(),
	rerankEnabled: z.boolean(),
	rerankingServiceId: z.string(),
	rerankMaxResults: z.string(),
});
type FormInput = z.infer<typeof FormSchema>;

const NONE_VALUE = "__none__";

function toFormDefaults(agent: AgentRecord | null): FormInput {
	return {
		name: agent?.name ?? "",
		description: agent?.description ?? "",
		systemPrompt: agent?.systemPrompt ?? "",
		llmServiceId: agent?.llmServiceId ?? "",
		knowledgeBaseIds: agent?.knowledgeBaseIds ?? [],
		ragEnabled: agent?.ragEnabled ?? true,
		ragMaxResults: agent?.ragMaxResults?.toString() ?? "",
		ragMinScore: agent?.ragMinScore?.toString() ?? "",
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

function parseOptionalFloat(value: string): number | null {
	if (value.trim() === "") return null;
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : null;
}

function buildPayload(values: FormInput): CreateAgentInput {
	return {
		name: values.name.trim(),
		description: values.description.trim() || null,
		systemPrompt: values.systemPrompt.trim() || null,
		llmServiceId: values.llmServiceId || null,
		knowledgeBaseIds: values.knowledgeBaseIds,
		ragEnabled: values.ragEnabled,
		ragMaxResults: parseOptionalInt(values.ragMaxResults),
		ragMinScore: parseOptionalFloat(values.ragMinScore),
		rerankEnabled: values.rerankEnabled,
		rerankingServiceId: values.rerankingServiceId || null,
		rerankMaxResults: parseOptionalInt(values.rerankMaxResults),
	};
}

export interface AgentFormProps {
	readonly mode: "create" | "edit";
	readonly agent?: AgentRecord | null;
	readonly knowledgeBases: readonly KnowledgeBaseRecord[];
	readonly llmServices: readonly LlmServiceRecord[];
	readonly rerankingServices: readonly RerankingServiceRecord[];
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
	submitting,
	onSubmit,
	onCancel,
}: AgentFormProps) {
	const form = useForm<FormInput>({
		resolver: zodResolver(FormSchema),
		defaultValues: toFormDefaults(agent ?? null),
	});

	const ragEnabled = form.watch("ragEnabled");
	const rerankEnabled = form.watch("rerankEnabled");
	const selectedKbIds = form.watch("knowledgeBaseIds");
	const errors = form.formState.errors;

	function toggleKb(kbId: string): void {
		const current = form.getValues("knowledgeBaseIds");
		const next = current.includes(kbId)
			? current.filter((id) => id !== kbId)
			: [...current, kbId];
		form.setValue("knowledgeBaseIds", next, { shouldDirty: true });
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
					<p className="text-xs text-red-600">{errors.name.message}</p>
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
				<Label className="text-sm font-medium">Knowledge base bindings</Label>
				<p className="text-xs text-slate-500">
					Default RAG scope for conversations against this agent. Leave empty to
					draw from every KB in the workspace.
				</p>
				{knowledgeBases.length === 0 ? (
					<p className="text-xs text-slate-500 italic">
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
										className="h-4 w-4 rounded border-slate-300 text-[var(--color-brand-500)] focus:ring-[var(--color-brand-500)]"
									/>
									<span className="font-medium">{kb.name}</span>
									{kb.description ? (
										<span className="text-slate-500 text-xs">
											— {kb.description}
										</span>
									) : null}
								</label>
							);
						})}
					</div>
				)}
			</div>

			<fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50/50 p-4">
				<label className="flex items-center gap-2 text-sm font-medium">
					<input
						type="checkbox"
						{...form.register("ragEnabled")}
						className="h-4 w-4 rounded border-slate-300 text-[var(--color-brand-500)] focus:ring-[var(--color-brand-500)]"
					/>
					Enable retrieval-augmented generation
				</label>
				{ragEnabled ? (
					<div className="grid grid-cols-2 gap-3 pl-6">
						<div className="flex flex-col gap-1.5">
							<FieldLabel
								htmlFor="agent-rag-max"
								help="Optional. Max results per turn — defaults to runtime config."
							>
								Max results per turn
							</FieldLabel>
							<Input
								id="agent-rag-max"
								type="number"
								min={1}
								placeholder="e.g. 6"
								{...form.register("ragMaxResults")}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<FieldLabel
								htmlFor="agent-rag-min-score"
								help="Optional. Drop hits below this similarity score."
							>
								Min score
							</FieldLabel>
							<Input
								id="agent-rag-min-score"
								type="number"
								step="0.01"
								placeholder="e.g. 0.5"
								{...form.register("ragMinScore")}
							/>
						</div>
					</div>
				) : null}
			</fieldset>

			<fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50/50 p-4">
				<label className="flex items-center gap-2 text-sm font-medium">
					<input
						type="checkbox"
						{...form.register("rerankEnabled")}
						className="h-4 w-4 rounded border-slate-300 text-[var(--color-brand-500)] focus:ring-[var(--color-brand-500)]"
					/>
					Enable reranking
				</label>
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
