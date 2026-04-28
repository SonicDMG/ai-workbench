import { zodResolver } from "@hookform/resolvers/zod";
import { type FormEvent, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import {
	type CreateWorkspaceInput,
	CreateWorkspaceSchema,
	KIND_DESCRIPTIONS,
	type UpdateWorkspaceInput,
	UpdateWorkspaceSchema,
	type Workspace,
	type WorkspaceKind,
} from "@/lib/schemas";
import { CredentialsEditor } from "./CredentialsEditor";

/**
 * Starter credentials per kind. When a user picks a backend in the
 * onboarding wizard we pre-populate the editor with the env-var refs
 * the upstream SDK documentation uses, so the happy path is "paste
 * your token into your .env and click Create." Everything here is
 * editable — users can remove, rename, or add rows before submit.
 *
 * `url` lives on the workspace record directly (not here); the
 * form pre-fills it separately with `env:ASTRA_DB_API_ENDPOINT`.
 */
const DEFAULT_CREDENTIALS: Record<WorkspaceKind, Record<string, string>> = {
	astra: { token: "env:ASTRA_DB_APPLICATION_TOKEN" },
	hcd: { token: "env:ASTRA_DB_APPLICATION_TOKEN" },
	openrag: {},
	mock: {},
};

/**
 * Starter `url` per kind. Astra / HCD get the canonical env-var
 * ref; others get an empty default.
 */
const DEFAULT_ENDPOINT: Record<WorkspaceKind, string> = {
	astra: "env:ASTRA_DB_API_ENDPOINT",
	hcd: "env:ASTRA_DB_API_ENDPOINT",
	openrag: "",
	mock: "",
};

/**
 * Reusable form for create + edit. In create mode, `kind` is baked in
 * by the parent (the onboarding flow picks it first). In edit mode,
 * `kind` is shown read-only — it's immutable after creation.
 */
export type WorkspaceFormMode =
	| {
			mode: "create";
			kind: WorkspaceKind;
			onSubmit: (v: CreateWorkspaceInput) => void;
	  }
	| {
			mode: "edit";
			workspace: Workspace;
			onSubmit: (v: UpdateWorkspaceInput) => void;
	  };

type WorkspaceFormValues = {
	name: string;
	kind?: WorkspaceKind;
	url: string | null;
	keyspace: string | null;
	credentials: Record<string, string>;
};

export function WorkspaceForm(
	props: WorkspaceFormMode & {
		submitting?: boolean;
		submitLabel?: string;
		onCancel?: () => void;
	},
) {
	const kind = props.mode === "create" ? props.kind : props.workspace.kind;

	const defaultValues: WorkspaceFormValues =
		props.mode === "create"
			? {
					name: "",
					kind,
					url: DEFAULT_ENDPOINT[kind],
					keyspace: "",
					credentials: { ...DEFAULT_CREDENTIALS[kind] },
				}
			: {
					name: props.workspace.name,
					url: props.workspace.url ?? "",
					keyspace: props.workspace.keyspace ?? "",
					credentials: { ...props.workspace.credentials },
				};

	const schema =
		props.mode === "create" ? CreateWorkspaceSchema : UpdateWorkspaceSchema;

	const {
		register,
		handleSubmit,
		control,
		formState: { errors },
	} = useForm<WorkspaceFormValues>({
		// biome-ignore lint/suspicious/noExplicitAny: Zod discriminates by mode; resolver generics can't see through
		resolver: zodResolver(schema as any),
		defaultValues,
		mode: "onBlur",
	});
	const [submitError, setSubmitError] = useState<string | null>(null);

	function onValid(data: WorkspaceFormValues) {
		setSubmitError(null);
		if (props.mode === "create") {
			props.onSubmit({ ...data, kind });
		} else {
			props.onSubmit(data);
		}
	}

	function onInvalid(formErrors: unknown) {
		setSubmitError(firstValidationMessage(formErrors));
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		void handleSubmit(
			onValid,
			onInvalid,
		)(event).catch((err: unknown) => {
			setSubmitError(firstValidationMessage(err));
		});
	}

	const astraLike = kind === "astra" || kind === "hcd";

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-5">
			<div className="flex flex-col gap-1.5">
				<FieldLabel
					htmlFor="name"
					help="A friendly label for this workspace, such as production, staging, or demo. It does not need to be globally unique."
				>
					Name
				</FieldLabel>
				<Input
					id="name"
					placeholder="e.g. production, staging, demo"
					aria-invalid={Boolean(errors.name)}
					{...register("name")}
				/>
				{errors.name ? (
					<p className="text-xs text-red-600">
						{errors.name.message as string}
					</p>
				) : (
					<p className="text-xs text-slate-500">
						A human-readable label. Not unique — the workspaceId is the
						identity.
					</p>
				)}
			</div>

			<div className="flex flex-col gap-1.5">
				<div className="flex items-baseline justify-between">
					<FieldLabel help="The backend this workspace connects to. This is chosen during creation and cannot be changed later because it controls driver behavior.">
						Kind
					</FieldLabel>
					{props.mode === "edit" ? (
						<span className="text-xs text-slate-500">
							Read-only — immutable after creation
						</span>
					) : null}
				</div>
				<div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
					<span className="font-medium">{kind}</span>
					<span className="text-slate-400">—</span>
					<span className="text-slate-500 text-xs truncate">
						{KIND_DESCRIPTIONS[kind]}
					</span>
				</div>
			</div>

			{astraLike ? (
				<div className="flex flex-col gap-1.5">
					<FieldLabel
						htmlFor="keyspace"
						help="The Astra keyspace the workspace will use. Leave it empty to let the runtime use the default keyspace for the database."
					>
						Keyspace
					</FieldLabel>
					<Input
						id="keyspace"
						placeholder="default_keyspace"
						{...register("keyspace")}
					/>
					<p className="text-xs text-slate-500">
						The Astra keyspace this workspace targets. Leave empty to use the
						default.
					</p>
				</div>
			) : null}

			<div className="flex flex-col gap-1.5">
				<FieldLabel
					htmlFor="url"
					help={
						astraLike
							? "The Data API endpoint for this Astra database. You can paste the URL directly or use a SecretRef such as env:ASTRA_DB_API_ENDPOINT."
							: "The data-plane endpoint for this workspace. Use a URL directly or a SecretRef such as env:WORKSPACE_URL."
					}
				>
					{astraLike ? "Data API url" : "Url"}
				</FieldLabel>
				<Input
					id="url"
					placeholder={
						astraLike
							? "env:ASTRA_DB_API_ENDPOINT or https://<db-id>-<region>.apps.astra.datastax.com"
							: "url URL or env:VAR ref"
					}
					aria-invalid={Boolean(errors.url)}
					{...register("url")}
				/>
				{errors.url ? (
					<p className="text-xs text-red-600">{errors.url.message as string}</p>
				) : astraLike ? (
					<p className="text-xs text-slate-500">
						The per-workspace Data API URL. Paste it in directly, or use a
						SecretRef like <code className="font-mono">env:VAR</code> /{" "}
						<code className="font-mono">file:/path</code>. Each Astra DB has its
						own url — one workspace per DB.
					</p>
				) : (
					<p className="text-xs text-slate-500">
						Data-plane url for this workspace. URL or SecretRef.
					</p>
				)}
			</div>

			{astraLike ? (
				<Controller
					control={control}
					name="credentials"
					render={({ field }) => (
						<CredentialsEditor
							value={(field.value as Record<string, string>) ?? {}}
							onChange={field.onChange}
							disabled={props.submitting}
						/>
					)}
				/>
			) : null}

			{submitError ? (
				<p className="text-sm text-red-600" role="alert" aria-live="polite">
					{submitError}
				</p>
			) : null}

			<div className="flex items-center justify-end gap-2 pt-2">
				{props.onCancel ? (
					<Button
						type="button"
						variant="ghost"
						onClick={props.onCancel}
						disabled={props.submitting}
					>
						Cancel
					</Button>
				) : null}
				<Button type="submit" variant="brand" disabled={props.submitting}>
					{props.submitting
						? "Saving…"
						: (props.submitLabel ??
							(props.mode === "create" ? "Create workspace" : "Save changes"))}
				</Button>
			</div>
		</form>
	);
}

function firstValidationMessage(errors: unknown): string {
	return (
		findValidationMessage(errors) ??
		"Check the highlighted fields and try again."
	);
}

function findValidationMessage(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;

	const issues = (value as { issues?: unknown }).issues;
	if (Array.isArray(issues)) {
		for (const issue of issues) {
			const found = findValidationMessage(issue);
			if (found) return found;
		}
	}

	const candidate = value as { message?: unknown };
	if (typeof candidate.message === "string" && candidate.message.length > 0) {
		return candidate.message;
	}

	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (key === "ref") continue;
		const found = findValidationMessage(child);
		if (found) return found;
	}

	return null;
}
