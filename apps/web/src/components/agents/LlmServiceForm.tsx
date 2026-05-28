import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type {
	CreateLlmServiceInput,
	LlmServiceRecord,
	UpdateLlmServiceInput,
} from "@/lib/schemas";

/**
 * Provider options. Only `huggingface` is wired through the runtime
 * today (see `chat/agent-dispatch.ts`); the other providers are
 * accepted at create time for forward-compat but produce
 * `422 llm_provider_unsupported` at send time.
 */
const PROVIDERS: readonly { readonly value: string; readonly label: string }[] =
	[
		{ value: "huggingface", label: "HuggingFace (wired)" },
		{ value: "openai", label: "OpenAI (not yet wired)" },
		{ value: "anthropic", label: "Anthropic (not yet wired)" },
		{ value: "cohere", label: "Cohere (not yet wired)" },
	];

/**
 * Sentinel value that switches the model `<Select>` into a free-form
 * `<Input>`. Anything not in the popular list (including legacy
 * services created before this picker shipped) renders as "Other".
 */
const OTHER_MODEL = "__other__";

interface PopularModel {
	readonly provider: string;
	readonly modelName: string;
	readonly label: string;
	/** Sensible per-model default so picking a row fills the rest. */
	readonly maxOutputTokens?: number;
}

/**
 * Curated popular-models menu surfaced as quick picks. Today
 * HuggingFace dominates because the runtime only wires HF chat — the
 * other providers stay reachable through "Other (custom)" so
 * forward-compat doesn't regress. Keep this list short and
 * opinionated: it's a starter menu, not an exhaustive catalog.
 */
const POPULAR_MODELS: readonly PopularModel[] = [
	{
		provider: "huggingface",
		modelName: "mistralai/Mistral-7B-Instruct-v0.3",
		label: "Mistral-7B-Instruct v0.3 (default)",
		maxOutputTokens: 1024,
	},
	{
		provider: "huggingface",
		modelName: "meta-llama/Meta-Llama-3-8B-Instruct",
		label: "Llama 3 8B Instruct",
		maxOutputTokens: 1024,
	},
	{
		provider: "huggingface",
		modelName: "meta-llama/Llama-3.1-8B-Instruct",
		label: "Llama 3.1 8B Instruct",
		maxOutputTokens: 2048,
	},
	{
		provider: "huggingface",
		modelName: "mistralai/Mixtral-8x7B-Instruct-v0.1",
		label: "Mixtral 8x7B Instruct",
		maxOutputTokens: 2048,
	},
	{
		provider: "huggingface",
		modelName: "HuggingFaceH4/zephyr-7b-beta",
		label: "Zephyr 7B Beta",
		maxOutputTokens: 1024,
	},
	{
		provider: "huggingface",
		modelName: "Qwen/Qwen2.5-7B-Instruct",
		label: "Qwen 2.5 7B Instruct",
		maxOutputTokens: 2048,
	},
	{
		provider: "huggingface",
		modelName: "google/gemma-2-9b-it",
		label: "Gemma 2 9B (IT)",
		maxOutputTokens: 2048,
	},
];

function findPopularModel(modelName: string): PopularModel | null {
	return POPULAR_MODELS.find((m) => m.modelName === modelName) ?? null;
}

const FormSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string(),
	provider: z.string().min(1, "Provider is required"),
	modelName: z.string().min(1, "Model is required"),
	credentialRef: z.string(),
	maxOutputTokens: z.string(),
});
type FormInput = z.infer<typeof FormSchema>;

function toFormDefaults(svc: LlmServiceRecord | null): FormInput {
	return {
		name: svc?.name ?? "",
		description: svc?.description ?? "",
		provider: svc?.provider ?? "huggingface",
		modelName: svc?.modelName ?? "",
		credentialRef: svc?.credentialRef ?? "",
		maxOutputTokens: svc?.maxOutputTokens?.toString() ?? "",
	};
}

function parseOptionalInt(value: string): number | null {
	if (value.trim() === "") return null;
	const n = Number.parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function buildPayload(values: FormInput): CreateLlmServiceInput {
	return {
		name: values.name.trim(),
		description: values.description.trim() || null,
		provider: values.provider,
		modelName: values.modelName.trim(),
		credentialRef: values.credentialRef.trim() || null,
		maxOutputTokens: parseOptionalInt(values.maxOutputTokens),
	};
}

export interface LlmServiceFormProps {
	readonly mode: "create" | "edit";
	readonly service?: LlmServiceRecord | null;
	readonly submitting?: boolean;
	readonly onSubmit: (
		values: CreateLlmServiceInput | UpdateLlmServiceInput,
	) => Promise<void> | void;
	readonly onCancel?: () => void;
}

export function LlmServiceForm({
	mode,
	service,
	submitting,
	onSubmit,
	onCancel,
}: LlmServiceFormProps) {
	const form = useForm<FormInput>({
		resolver: zodResolver(FormSchema),
		defaultValues: toFormDefaults(service ?? null),
	});

	const errors = form.formState.errors;
	const provider = form.watch("provider");

	// The picker is a separate piece of state because "Other (custom)"
	// can't be derived from `modelName` alone — an empty modelName in
	// edit mode would otherwise look like "no selection". We seed from
	// the model name: matches a popular row → that row selected;
	// otherwise → "Other".
	const [modelPick, setModelPick] = useState<string>(() =>
		findPopularModel(service?.modelName ?? "")
			? (service?.modelName ?? "")
			: "",
	);
	const showCustomModel = modelPick === "" || modelPick === OTHER_MODEL;

	function onPickModel(value: string): void {
		setModelPick(value);
		if (value === OTHER_MODEL) {
			// Clear so the operator types their own. We don't touch
			// provider — they may want a custom OpenAI / Cohere model
			// after picking Other.
			form.setValue("modelName", "", { shouldDirty: true });
			return;
		}
		const popular = findPopularModel(value);
		if (!popular) return;
		form.setValue("modelName", popular.modelName, { shouldDirty: true });
		form.setValue("provider", popular.provider, { shouldDirty: true });
		if (popular.maxOutputTokens !== undefined) {
			form.setValue("maxOutputTokens", String(popular.maxOutputTokens), {
				shouldDirty: true,
			});
		}
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
					htmlFor="llm-name"
					help="A human-friendly label. Shown in agent pickers and lists."
				>
					Name
				</FieldLabel>
				<Input
					id="llm-name"
					placeholder="e.g. mistral-7b-prod"
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
					htmlFor="llm-description"
					help="Optional context for teammates."
				>
					Description (optional)
				</FieldLabel>
				<Input
					id="llm-description"
					placeholder="Production HuggingFace inference endpoint"
					{...form.register("description")}
				/>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div className="flex flex-col gap-1.5">
					<FieldLabel
						htmlFor="llm-provider"
						help="Today only HuggingFace is wired through the chat dispatcher. Other providers are accepted at create time but produce 422 llm_provider_unsupported when an agent tries to send."
					>
						Provider
					</FieldLabel>
					<Select
						value={provider}
						onValueChange={(v) =>
							form.setValue("provider", v, { shouldDirty: true })
						}
					>
						<SelectTrigger id="llm-provider">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PROVIDERS.map((p) => (
								<SelectItem key={p.value} value={p.value}>
									{p.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{errors.provider ? (
						<p className="text-xs text-red-600 dark:text-red-400">
							{errors.provider.message}
						</p>
					) : null}
				</div>

				<div className="flex flex-col gap-1.5">
					<FieldLabel
						htmlFor="llm-model"
						help="Pick a popular HuggingFace model or choose 'Other (custom)' to type any model name. Provider auto-switches to match the picked model."
					>
						Model
					</FieldLabel>
					<Select
						value={showCustomModel ? OTHER_MODEL : (modelPick ?? OTHER_MODEL)}
						onValueChange={onPickModel}
					>
						<SelectTrigger id="llm-model">
							<SelectValue placeholder="Pick a model" />
						</SelectTrigger>
						<SelectContent>
							{POPULAR_MODELS.map((m) => (
								<SelectItem key={m.modelName} value={m.modelName}>
									{m.label}
								</SelectItem>
							))}
							<SelectItem value={OTHER_MODEL}>Other (custom)…</SelectItem>
						</SelectContent>
					</Select>
					{showCustomModel ? (
						<Input
							id="llm-model-custom"
							placeholder="e.g. mistralai/Mistral-7B-Instruct-v0.3"
							aria-invalid={errors.modelName ? true : undefined}
							aria-label="Custom model name"
							{...form.register("modelName")}
						/>
					) : null}
					{errors.modelName ? (
						<p className="text-xs text-red-600 dark:text-red-400">
							{errors.modelName.message}
						</p>
					) : null}
				</div>
			</div>

			<div className="flex flex-col gap-1.5">
				<FieldLabel
					htmlFor="llm-credential-ref"
					help={`Optional secret reference for the API token: env:VAR_NAME or file:/path. Leave blank to fall back to the runtime's global chat: token.`}
				>
					Credential reference (optional)
				</FieldLabel>
				<Input
					id="llm-credential-ref"
					placeholder="env:HUGGINGFACE_API_KEY"
					{...form.register("credentialRef")}
				/>
				<p className="text-xs text-slate-500 dark:text-slate-400">
					Format: <code>env:VAR_NAME</code> or <code>file:/path</code>. Plain
					token strings are rejected by the runtime.
				</p>
			</div>

			<div className="flex flex-col gap-1.5">
				<FieldLabel
					htmlFor="llm-max-output"
					help="Optional. Caps the model's output per turn. Defaults to runtime config (typically 1024)."
				>
					Max output tokens (optional)
				</FieldLabel>
				<Input
					id="llm-max-output"
					type="number"
					min={1}
					placeholder="e.g. 2048"
					{...form.register("maxOutputTokens")}
				/>
			</div>

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
							? "Create LLM service"
							: "Save changes"}
				</Button>
			</div>
		</form>
	);
}
