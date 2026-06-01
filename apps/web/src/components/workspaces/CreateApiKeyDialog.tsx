import { AlertTriangle, KeyRound } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/common/CopyButton";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateApiKey } from "@/hooks/useApiKeys";
import { formatApiError } from "@/lib/api";
import type { ApiKeyScope } from "@/lib/schemas";

/**
 * Role-based key presets (0.4.0 RBAC). A key is minted by picking a
 * role; the role expands into the privilege scopes sent on the create
 * request. This mirrors the server's role → scope mapping
 * (`runtimes/typescript/src/auth/roles.ts`):
 *
 *   viewer → [read]                 read-only.
 *   editor → [read, write]          mutate workspace content.
 *   admin  → [read, write, manage]  + admin ops (mint/revoke keys,
 *                                   delete the workspace).
 *
 * Picking a role (rather than raw scopes) keeps the UX legible — most
 * operators think in "what can this key do", not in scope tuples — and
 * the key list collapses the same scope sets back to a role label.
 *
 * `help` is rendered as plain React children (not markdown), so the
 * shape is a flat list of strings / `<code>` spans. Keeping it in a
 * data array (rather than literal JSX inside the render) lets the
 * picker stay a single map over `ROLE_PRESETS`.
 */
const ROLE_PRESETS = [
	{
		id: "editor" as const,
		label: "Editor",
		scopeSummary: "read + write",
		help: [
			"Retrieval and mutation of workspace content — search, ingest, KB / agent / service CRUD. Same access as keys minted before roles existed. Cannot manage keys or delete the workspace.",
		],
		scopes: ["read", "write"] as const,
	},
	{
		id: "viewer" as const,
		label: "Viewer",
		scopeSummary: "read",
		help: [
			"Retrieval only — ",
			{ code: "search_kb" },
			", ",
			{ code: "list_documents" },
			", etc. Rejects MCP write tools (",
			{ code: "ingest_text" },
			", ",
			{ code: "delete_document" },
			") and every mutating route. Good for external agents you don't fully trust.",
		],
		scopes: ["read"] as const,
	},
	{
		id: "admin" as const,
		label: "Admin",
		scopeSummary: "read + write + manage",
		help: [
			"Everything an Editor can do, plus admin operations: mint / revoke API keys and delete the workspace. Issue sparingly — an Admin key can mint more keys.",
		],
		scopes: ["read", "write", "manage"] as const,
	},
] as const;

/** The role-picker choices: the three presets plus the advanced custom mode. */
type KeyRoleChoice = (typeof ROLE_PRESETS)[number]["id"] | "custom";

/**
 * Fine-grained scope catalog for the "Custom (advanced)" picker (0.5.0).
 * Grouped by coarse tier; mirrors `ALL_API_KEY_SCOPES` in
 * `runtimes/typescript/src/control-plane/types.ts` (order included) so the
 * UI offers exactly what the server accepts. A held coarse tier is a
 * superset of its fine grants on the server (containment), so checking
 * `write` is equivalent to checking every `write:*` — but operators can
 * pick a single facet (e.g. `write:ingest`) to narrow a key.
 */
const SCOPE_GROUPS = [
	{
		tier: "read",
		label: "Read",
		scopes: [
			{ id: "read", desc: "All read access (coarse tier)." },
			{ id: "read:content", desc: "KB search + document / chunk reads." },
			{ id: "read:chat", desc: "Conversation + message history." },
			{ id: "read:audit", desc: "Policy-audit log." },
		],
	},
	{
		tier: "write",
		label: "Write",
		scopes: [
			{ id: "write", desc: "All write access (coarse tier)." },
			{ id: "write:ingest", desc: "Ingest + document / record CRUD." },
			{ id: "write:kb", desc: "Knowledge-base + knowledge-filter CRUD." },
			{ id: "write:services", desc: "Execution services + MCP servers." },
			{ id: "write:agents", desc: "Agent CRUD." },
		],
	},
	{
		tier: "manage",
		label: "Manage",
		scopes: [
			{ id: "manage", desc: "All admin access (coarse tier)." },
			{ id: "manage:keys", desc: "Mint / revoke API keys." },
			{ id: "manage:access", desc: "RLAC principals + policy." },
			{ id: "manage:workspace", desc: "Delete the workspace." },
		],
	},
	{
		tier: "tools",
		label: "Tools",
		scopes: [
			{ id: "tools:invoke", desc: "Let agents call external MCP tools." },
		],
	},
] as const;

type HelpFragment = string | { readonly code: string };

function renderHelpFragments(fragments: readonly HelpFragment[]): ReactNode {
	return fragments.map((fragment, idx) => {
		if (typeof fragment === "string") {
			// biome-ignore lint/suspicious/noArrayIndexKey: fragments are static literals in SCOPE_PRESETS — order never changes between renders.
			return <Fragment key={idx}>{fragment}</Fragment>;
		}
		return (
			<code
				// biome-ignore lint/suspicious/noArrayIndexKey: see above.
				key={idx}
				className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-200"
			>
				{fragment.code}
			</code>
		);
	});
}

/**
 * Two-phase dialog:
 *   1. Label entry → POST → plaintext once-shown reveal screen.
 *   2. Reveal screen: big CopyButton, warning, Done.
 * Closing mid-reveal keeps the key (it's already on the server) but
 * the plaintext is gone for good.
 */
export function CreateApiKeyDialog({
	workspace,
	open,
	onOpenChange,
}: {
	workspace: string;
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const create = useCreateApiKey(workspace);
	const [label, setLabel] = useState("");
	// Default to Editor (read + write) — the same effective access keys
	// carried before the role picker existed, so the common "mint a key
	// for first-party tooling" path is unchanged by default.
	const [role, setRole] = useState<KeyRoleChoice>("editor");
	// Only consulted when `role === "custom"`. A flat set of fine/coarse
	// scope ids the operator ticked in the advanced tree.
	const [customScopes, setCustomScopes] = useState<readonly ApiKeyScope[]>([]);
	const [plaintext, setPlaintext] = useState<string | null>(null);

	function reset() {
		setLabel("");
		setRole("editor");
		setCustomScopes([]);
		setPlaintext(null);
		create.reset();
	}

	function toggleScope(id: ApiKeyScope) {
		setCustomScopes((prev) =>
			prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
		);
	}

	// The scope set the chosen role/custom selection sends. Custom uses the
	// ticked tree; a preset expands to its fixed scopes (Editor default if a
	// preset is ever removed in a refactor).
	const selectedScopes =
		role === "custom"
			? customScopes
			: (ROLE_PRESETS.find((p) => p.id === role)?.scopes ?? ["read", "write"]);

	async function submit() {
		const trimmed = label.trim();
		if (!trimmed) return;
		// Custom mode must carry at least one scope (server enforces min(1)).
		if (selectedScopes.length === 0) return;
		try {
			const res = await create.mutateAsync({
				label: trimmed,
				scopes: [...selectedScopes],
			});
			setPlaintext(res.plaintext);
			toast.success(`API key '${res.key.label}' created`);
		} catch (err) {
			toast.error("Couldn't create API key", {
				description: formatApiError(err),
			});
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				onOpenChange(o);
				if (!o) reset();
			}}
		>
			<DialogContent>
				{plaintext === null ? (
					<>
						<DialogHeader>
							<DialogTitle>Create an API key</DialogTitle>
							<DialogDescription>
								Keys are scoped to this workspace. The plaintext token is shown{" "}
								<strong>exactly once</strong> — there is no way to retrieve it
								later. Store it somewhere safe before closing the dialog.
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-1.5">
							<FieldLabel
								htmlFor="key-label"
								help="A human-readable label for the key, such as ci, python-notebook, or a teammate's laptop. It helps operators tell active keys apart later."
							>
								Label
							</FieldLabel>
							<Input
								id="key-label"
								placeholder="e.g. ci, python-notebook, bob-laptop"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") submit();
								}}
								autoFocus
							/>
							<p className="text-xs text-slate-500 dark:text-slate-400">
								A human-readable name that shows up in the keys list. Required
								so operators can tell keys apart.
							</p>
						</div>
						<div className="flex flex-col gap-2">
							<FieldLabel
								htmlFor="key-role"
								help="The role this key acts as. Viewer is read-only (good for untrusted external agents); Editor can mutate workspace content (first-party tooling); Admin can additionally manage keys and delete the workspace. The role expands into the privilege scopes sent to the server."
							>
								Role
							</FieldLabel>
							<div
								id="key-role"
								className="flex flex-col gap-2"
								role="radiogroup"
								aria-label="Key role"
							>
								{ROLE_PRESETS.map((p) => (
									<label
										key={p.id}
										className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
											role === p.id
												? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] dark:bg-[var(--color-brand-950)]/30"
												: "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
										}`}
									>
										<input
											type="radio"
											name="key-role"
											value={p.id}
											checked={role === p.id}
											onChange={() => setRole(p.id)}
											className="mt-1"
										/>
										<div className="flex min-w-0 flex-col gap-0.5">
											<span className="flex flex-wrap items-center gap-2">
												<span className="text-sm font-medium text-slate-900 dark:text-slate-100">
													{p.label}
												</span>
												<code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
													{p.scopeSummary}
												</code>
											</span>
											<span className="text-xs text-slate-500 dark:text-slate-400">
												{renderHelpFragments(p.help)}
											</span>
										</div>
									</label>
								))}
								<label
									className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
										role === "custom"
											? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] dark:bg-[var(--color-brand-950)]/30"
											: "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
									}`}
								>
									<input
										type="radio"
										name="key-role"
										value="custom"
										checked={role === "custom"}
										onChange={() => setRole("custom")}
										className="mt-1"
									/>
									<div className="flex min-w-0 flex-col gap-0.5">
										<span className="flex flex-wrap items-center gap-2">
											<span className="text-sm font-medium text-slate-900 dark:text-slate-100">
												Custom (advanced)
											</span>
											<code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
												choose scopes
											</code>
										</span>
										<span className="text-xs text-slate-500 dark:text-slate-400">
											Pick exact privilege scopes. Coarse tiers are supersets of
											their fine grants — pick a single facet to narrow a key.
										</span>
									</div>
								</label>
							</div>
							{role === "custom" ? (
								<div
									className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700"
									role="group"
									aria-label="Custom scopes"
								>
									{SCOPE_GROUPS.map((group) => (
										<fieldset
											key={group.tier}
											className="flex flex-col gap-1.5"
										>
											<legend className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
												{group.label}
											</legend>
											{group.scopes.map((s) => (
												<label
													key={s.id}
													className="flex cursor-pointer items-start gap-2"
												>
													<input
														type="checkbox"
														checked={customScopes.includes(s.id)}
														onChange={() => toggleScope(s.id)}
														className="mt-1"
													/>
													<span className="flex min-w-0 flex-col">
														<code className="font-mono text-[11px] text-slate-700 dark:text-slate-200">
															{s.id}
														</code>
														<span className="text-xs text-slate-500 dark:text-slate-400">
															{s.desc}
														</span>
													</span>
												</label>
											))}
										</fieldset>
									))}
									{customScopes.length === 0 ? (
										<p className="text-xs text-amber-600 dark:text-amber-400">
											Select at least one scope to mint a custom key.
										</p>
									) : null}
								</div>
							) : null}
						</div>
						<DialogFooter>
							<Button
								variant="ghost"
								onClick={() => onOpenChange(false)}
								disabled={create.isPending}
							>
								Cancel
							</Button>
							<Button
								variant="brand"
								onClick={submit}
								disabled={
									label.trim().length === 0 ||
									create.isPending ||
									selectedScopes.length === 0
								}
							>
								{create.isPending ? "Creating…" : "Create key"}
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<KeyRound className="h-5 w-5 text-[var(--color-brand-600)]" />
								Copy your key now
							</DialogTitle>
							<DialogDescription>
								This is the only time you'll see the plaintext. After you close
								this dialog it's gone — the runtime only keeps a scrypt digest.
							</DialogDescription>
						</DialogHeader>
						<div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
							<AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0 dark:text-amber-400" />
							<span>
								Treat this like a password. Don't commit it, don't paste it into
								chat, don't log it. Revoke and re-issue if it leaks.
							</span>
						</div>
						<div className="flex flex-col gap-2">
							<Label>Token</Label>
							<div className="flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 dark:border-slate-600 dark:bg-slate-800">
								<code className="flex-1 font-mono text-xs break-all text-slate-900 dark:text-slate-100">
									{plaintext}
								</code>
								<CopyButton value={plaintext} label="Copy API key" />
							</div>
						</div>
						<DialogFooter>
							<Button variant="brand" onClick={() => onOpenChange(false)}>
								I've copied it, close
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
