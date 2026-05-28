import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useLlmModels } from "@/hooks/useConversations";
import type {
	CreateLlmServiceInput,
	LlmServiceRecord,
	UpdateLlmServiceInput,
} from "@/lib/schemas";

/**
 * Provider options. All three are OpenAI-compatible and wired through
 * the runtime (one adapter — see `chat/providers.ts`). `openrouter` is
 * the default (one key → 300+ models); `openai` is direct BYOK;
 * `ollama` is a local/offline server that needs no credential. Any
 * other provider value is accepted at create time but produces
 * `422 llm_provider_unsupported` at send time.
 */
const PROVIDERS: readonly { readonly value: string; readonly label: string }[] =
	[
		{ value: "openrouter", label: "OpenRouter (wired)" },
		{ value: "openai", label: "OpenAI — direct/BYOK (wired)" },
		{ value: "ollama", label: "Ollama — local/offline (wired)" },
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
	/** Surfaced under a "Recommended" group at the top of the picker. */
	readonly recommended?: boolean;
	/** Sensible per-model default so picking a row fills the rest. */
	readonly maxOutputTokens?: number;
}

/**
 * Curated popular-models menu surfaced as quick picks. OpenRouter slugs
 * dominate because it's the default provider (one key → 300+ models);
 * a local Ollama model is included for the offline path. Anything not
 * listed stays reachable through "Other (custom)". Keep this list short
 * and opinionated: it's a starter menu, not an exhaustive catalog.
 *
 * Every OpenRouter entry is a tool-calling-capable model — the agent
 * tool loop (list_kbs → search_kb → answer) needs native function
 * calling. The config-time probe catches any custom model picked via
 * "Other" that the caller's account/credits can't route.
 */
const POPULAR_MODELS: readonly PopularModel[] = [
	{
		provider: "openrouter",
		modelName: "openai/gpt-4o-mini",
		label: "GPT-4o mini (default)",
		maxOutputTokens: 1024,
	},
	{
		provider: "openrouter",
		modelName: "openai/gpt-4o",
		label: "GPT-4o",
		maxOutputTokens: 2048,
	},
	{
		provider: "openrouter",
		modelName: "anthropic/claude-3.5-sonnet",
		label: "Claude 3.5 Sonnet",
		maxOutputTokens: 2048,
	},
	{
		provider: "openrouter",
		modelName: "meta-llama/llama-3.3-70b-instruct",
		label: "Llama 3.3 70B Instruct",
		maxOutputTokens: 2048,
	},
	{
		provider: "ollama",
		modelName: "llama3.1",
		label: "Llama 3.1 (local Ollama)",
		maxOutputTokens: 2048,
	},
];

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
		provider: svc?.provider ?? "openrouter",
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

	// Live model catalog for the selected provider (OpenRouter `/models`,
	// Ollama `/models`). Falls back to the curated static list for this
	// provider while the query is pending or when offline.
	const modelsQuery = useLlmModels(provider);
	const pickerModels = useMemo<readonly PopularModel[]>(() => {
		const live = modelsQuery.data?.models;
		if (live && live.length > 0) {
			return live.map((m) => ({
				provider,
				modelName: m.id,
				label: m.name,
				recommended: m.recommended,
			}));
		}
		return POPULAR_MODELS.filter((m) => m.provider === provider);
	}, [modelsQuery.data, provider]);

	// `modelName` (the form field) is the source of truth for the
	// selection; `customModel` is true only when the operator explicitly
	// chose "Other (custom)" to type a free-form id.
	const currentModel = form.watch("modelName");
	const [customModel, setCustomModel] = useState(false);

	// What the picker renders: the provider's catalog, plus the
	// currently-saved model when the catalog doesn't already list it (a
	// live model absent from the offline fallback, a legacy/out-of-catalog
	// id, or a pick made before the catalog finished loading). Without
	// this, an existing selection silently collapses into "Other" on
	// reopen instead of staying selected.
	const options = useMemo<readonly PopularModel[]>(() => {
		if (customModel || !currentModel) return pickerModels;
		if (pickerModels.some((m) => m.modelName === currentModel))
			return pickerModels;
		return [
			{ provider, modelName: currentModel, label: currentModel },
			...pickerModels,
		];
	}, [pickerModels, currentModel, customModel, provider]);

	const recommendedOptions = options.filter((m) => m.recommended);
	const otherOptions = options.filter((m) => !m.recommended);
	const showCustomModel = customModel;

	function onPickModel(value: string): void {
		if (value === OTHER_MODEL) {
			// Switch to the free-form input. Provider is left alone — the
			// operator may want a custom OpenAI / Ollama model id.
			setCustomModel(true);
			form.setValue("modelName", "", { shouldDirty: true });
			return;
		}
		setCustomModel(false);
		const picked = options.find((m) => m.modelName === value);
		if (!picked) return;
		form.setValue("modelName", picked.modelName, { shouldDirty: true });
		form.setValue("provider", picked.provider, { shouldDirty: true });
		// Only the curated rows carry a sensible default cap; live catalog
		// entries leave the field untouched.
		if (picked.maxOutputTokens !== undefined) {
			form.setValue("maxOutputTokens", String(picked.maxOutputTokens), {
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
					placeholder="Production OpenRouter chat model"
					{...form.register("description")}
				/>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div className="flex flex-col gap-1.5">
					<FieldLabel
						htmlFor="llm-provider"
						help="OpenRouter, OpenAI (direct/BYOK), and Ollama (local) are all wired. Any other provider is accepted at create time but produces 422 llm_provider_unsupported when an agent tries to send."
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
						help="Pick a popular model or choose 'Other (custom)' to type any model id (e.g. an OpenRouter slug, or a local Ollama model). Provider auto-switches to match the picked model."
					>
						Model
					</FieldLabel>
					<Select
						value={customModel ? OTHER_MODEL : currentModel}
						onValueChange={onPickModel}
					>
						<SelectTrigger id="llm-model">
							<SelectValue placeholder="Pick a model" />
						</SelectTrigger>
						<SelectContent>
							{recommendedOptions.length > 0 ? (
								<SelectGroup>
									<SelectLabel>Recommended</SelectLabel>
									{recommendedOptions.map((m) => (
										<SelectItem key={m.modelName} value={m.modelName}>
											{m.label}
										</SelectItem>
									))}
								</SelectGroup>
							) : null}
							{otherOptions.length > 0 ? (
								<SelectGroup>
									{recommendedOptions.length > 0 ? (
										<SelectLabel>All models</SelectLabel>
									) : null}
									{otherOptions.map((m) => (
										<SelectItem key={m.modelName} value={m.modelName}>
											{m.label}
										</SelectItem>
									))}
								</SelectGroup>
							) : null}
							<SelectItem value={OTHER_MODEL}>Other (custom)…</SelectItem>
						</SelectContent>
					</Select>
					{showCustomModel ? (
						<Input
							id="llm-model-custom"
							placeholder="e.g. openai/gpt-4o-mini"
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
					placeholder="env:OPENROUTER_API_KEY"
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
