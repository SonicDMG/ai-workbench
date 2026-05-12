import { AlertTriangle, KeyRound } from "lucide-react";
import { useState } from "react";
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
 * Two-tier scope picker presets. Wider granularity (e.g. splitting
 * write into `write:ingest` / `write:admin`) lands when the routes
 * that consume it do; until then a toggle between "read only" and
 * "read + write" matches what the server accepts.
 */
const SCOPE_PRESETS = [
	{
		id: "read-write" as const,
		label: "Read + Write",
		help: "Full access — both retrieval and mutation. Same as keys minted before this picker existed.",
		scopes: ["read", "write"] as const,
	},
	{
		id: "read-only" as const,
		label: "Read only",
		help: "Retrieval only — `search_kb`, `list_documents`, etc. Reject MCP write tools (`ingest_text`, `delete_document`) and other mutating routes.",
		scopes: ["read"] as const,
	},
] as const;

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
	const [preset, setPreset] =
		useState<(typeof SCOPE_PRESETS)[number]["id"]>("read-write");
	const [plaintext, setPlaintext] = useState<string | null>(null);

	function reset() {
		setLabel("");
		setPreset("read-write");
		setPlaintext(null);
		create.reset();
	}

	async function submit() {
		const trimmed = label.trim();
		if (!trimmed) return;
		const chosen = SCOPE_PRESETS.find((p) => p.id === preset);
		// Should always resolve — the preset id is constrained — but fall
		// back to the "read + write" default rather than refusing to
		// submit if a future preset is removed in a refactor.
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
								htmlFor="key-scopes"
								help="Privilege tiers this key carries. Pick `Read only` for keys that hand out to external agents you don't fully trust; pick `Read + Write` for first-party tooling that ingests or maintains KB content."
							>
								Scopes
							</FieldLabel>
							<div
								id="key-scopes"
								className="flex flex-col gap-2"
								role="radiogroup"
								aria-label="Key scopes"
							>
								{SCOPE_PRESETS.map((p) => (
									<label
										key={p.id}
										className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
											preset === p.id
												? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] dark:bg-[var(--color-brand-950)]/30"
												: "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
										}`}
									>
										<input
											type="radio"
											name="key-scopes"
											value={p.id}
											checked={preset === p.id}
											onChange={() => setPreset(p.id)}
											className="mt-1"
										/>
										<div className="flex flex-col gap-0.5">
											<span className="text-sm font-medium text-slate-900 dark:text-slate-100">
												{p.label}
											</span>
											<span className="text-xs text-slate-500 dark:text-slate-400">
												{p.help}
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
