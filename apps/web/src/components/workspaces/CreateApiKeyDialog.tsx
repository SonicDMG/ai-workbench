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
	const [role, setRole] =
		useState<(typeof ROLE_PRESETS)[number]["id"]>("editor");
	const [plaintext, setPlaintext] = useState<string | null>(null);

	function reset() {
		setLabel("");
		setRole("editor");
		setPlaintext(null);
		create.reset();
	}

	async function submit() {
		const trimmed = label.trim();
		if (!trimmed) return;
		const chosen = ROLE_PRESETS.find((p) => p.id === role);
		// Should always resolve — the role id is constrained — but fall
		// back to the Editor (read + write) default rather than refusing
		// to submit if a future preset is removed in a refactor.
		const scopes = chosen?.scopes ?? ["read", "write"];
		try {
			const res = await create.mutateAsync({
				label: trimmed,
				scopes: [...scopes],
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
							</div>
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
								disabled={label.trim().length === 0 || create.isPending}
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
