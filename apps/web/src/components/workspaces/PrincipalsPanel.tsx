import { Pencil, Trash2, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	useCreatePrincipal,
	useDeletePrincipal,
	usePrincipals,
	useUpdatePrincipal,
} from "@/hooks/useRlac";
import { formatApiError } from "@/lib/api";
import type { PrincipalRecord } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * Workspace-scoped RLAC principal management.
 *
 * Principals are the sub-workspace identities that the policy DSL
 * evaluates against — typically email-like handles, OIDC subs, or
 * operator-chosen slugs. This panel lets the operator seed and
 * maintain the principal roster used by the demo "view as" picker.
 */
export function PrincipalsPanel({ workspace }: { workspace: string }) {
	const principals = usePrincipals(workspace);
	const [createOpen, setCreateOpen] = useState(false);
	const [toEdit, setToEdit] = useState<PrincipalRecord | null>(null);
	const [toDelete, setToDelete] = useState<PrincipalRecord | null>(null);

	if (principals.isLoading) return <LoadingState label="Loading principals…" />;
	if (principals.isError)
		return (
			<ErrorState
				title="Couldn't load principals"
				message={principals.error.message}
			/>
		);

	const rows = [...(principals.data ?? [])];

	return (
		<Card className="overflow-hidden shadow-sm">
			<CardHeader className="flex flex-col items-stretch gap-4 space-y-0 bg-slate-50/70 p-4 sm:flex-row sm:items-start sm:justify-between dark:bg-slate-900/60">
				<div className="flex min-w-0 items-start gap-3">
					<div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
						<Users className="h-4 w-4" />
					</div>
					<div className="min-w-0">
						<CardTitle className="text-base">Principals</CardTitle>
						<p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
							Sub-workspace identities the policy DSL evaluates against. Their
							ids surface as <code>current_principal_id()</code> inside a KB's
							policy expression.
							{rows.length === 0
								? " No principals yet."
								: ` ${rows.length} principal${rows.length === 1 ? "" : "s"}.`}
						</p>
					</div>
				</div>
				<div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
					<Button
						variant="brand"
						className="min-w-0 flex-1 sm:flex-none"
						onClick={() => setCreateOpen(true)}
					>
						<UserPlus className="h-4 w-4" />
						New principal
					</Button>
				</div>
			</CardHeader>
			<CardContent className="p-4 pt-3">
				{rows.length === 0 ? (
					<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400">
						No principals yet. Seed at least one (e.g. <code>alice</code>)
						before enabling a KB policy.
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-sm">
							<thead className="border-slate-200 border-b text-xs text-slate-500 uppercase tracking-wide dark:border-slate-700 dark:text-slate-400">
								<tr>
									<th className="pb-2 pr-3">Principal</th>
									<th className="pb-2 pr-3">Label</th>
									<th className="pb-2 pr-3">Attributes</th>
									<th className="pb-2 text-right">Actions</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((p) => (
									<tr
										key={p.principalId}
										className="border-slate-200 border-b last:border-b-0 dark:border-slate-800"
									>
										<td className="py-2 pr-3 font-mono text-xs text-slate-700 dark:text-slate-200">
											{p.principalId}
										</td>
										<td className="py-2 pr-3 text-slate-700 dark:text-slate-200">
											{p.label ?? <span className="text-slate-400">—</span>}
										</td>
										<td className="py-2 pr-3 text-slate-700 dark:text-slate-200">
											{Object.keys(p.attributes).length === 0 ? (
												<span className="text-slate-400">—</span>
											) : (
												<div className="flex flex-wrap gap-1">
													{Object.entries(p.attributes).map(([k, v]) => (
														<span
															key={k}
															className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300"
														>
															{k}={v}
														</span>
													))}
												</div>
											)}
										</td>
										<td className="py-2 text-right">
											<div className="flex items-center justify-end gap-1">
												<Button
													variant="ghost"
													size="icon"
													aria-label={`Edit ${p.principalId}`}
													onClick={() => setToEdit(p)}
													className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
												>
													<Pencil className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													aria-label={`Delete ${p.principalId}`}
													onClick={() => setToDelete(p)}
												>
													<Trash2 className="h-4 w-4 text-red-600" />
												</Button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</CardContent>

			<CreatePrincipalDialog
				workspace={workspace}
				open={createOpen}
				onOpenChange={setCreateOpen}
			/>
			<EditPrincipalDialog
				workspace={workspace}
				principal={toEdit}
				onClose={() => setToEdit(null)}
			/>
			<DeletePrincipalDialog
				workspace={workspace}
				principal={toDelete}
				onClose={() => setToDelete(null)}
			/>
		</Card>
	);
}

interface CreatePrincipalDialogProps {
	readonly workspace: string;
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
}

function CreatePrincipalDialog({
	workspace,
	open,
	onOpenChange,
}: CreatePrincipalDialogProps) {
	const create = useCreatePrincipal(workspace);
	const [principalId, setPrincipalId] = useState("");
	const [label, setLabel] = useState("");
	const [attrLines, setAttrLines] = useState(""); // "key=value" per line

	function parseAttributes(text: string): Record<string, string> {
		const out: Record<string, string> = {};
		for (const line of text.split(/\r?\n/)) {
			const idx = line.indexOf("=");
			if (idx < 1) continue;
			const k = line.slice(0, idx).trim();
			const v = line.slice(idx + 1).trim();
			if (k.length > 0) out[k] = v;
		}
		return out;
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		try {
			await create.mutateAsync({
				principalId: principalId.trim(),
				label: label.trim() || null,
				attributes: parseAttributes(attrLines),
			});
			toast.success(`Created principal '${principalId}'`);
			setPrincipalId("");
			setLabel("");
			setAttrLines("");
			onOpenChange(false);
		} catch (err) {
			toast.error(`Couldn't create principal: ${formatApiError(err)}`);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>New principal</DialogTitle>
					<DialogDescription>
						Add a sub-workspace identity. The id is free-form (typically an
						email, OIDC <code>sub</code>, or operator-chosen slug).
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} className="space-y-3">
					<label className="block space-y-1 text-sm">
						<span className="font-medium">Principal id</span>
						<input
							required
							autoFocus
							value={principalId}
							onChange={(e) => setPrincipalId(e.target.value)}
							placeholder="alice"
							className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
						/>
					</label>
					<label className="block space-y-1 text-sm">
						<span className="font-medium">Label (optional)</span>
						<input
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="Alice Anderson"
							className="w-full rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
						/>
					</label>
					<label className="block space-y-1 text-sm">
						<span className="font-medium">Attributes</span>
						<textarea
							value={attrLines}
							onChange={(e) => setAttrLines(e.target.value)}
							placeholder={"role=viewer\ndept=finance"}
							rows={3}
							className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
						/>
						<span className="text-slate-500 text-xs">
							One <code>key=value</code> per line. Referenced from the policy
							DSL as <code>$principal.&lt;key&gt;</code>.
						</span>
					</label>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="brand"
							disabled={create.isPending || principalId.trim().length === 0}
						>
							{create.isPending ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

interface DeletePrincipalDialogProps {
	readonly workspace: string;
	readonly principal: PrincipalRecord | null;
	readonly onClose: () => void;
}

function DeletePrincipalDialog({
	workspace,
	principal,
	onClose,
}: DeletePrincipalDialogProps) {
	const del = useDeletePrincipal(workspace);
	const isOpen = principal !== null;

	async function confirm() {
		if (!principal) return;
		try {
			await del.mutateAsync(principal.principalId);
			toast.success(`Deleted principal '${principal.principalId}'`);
			onClose();
		} catch (err) {
			toast.error(`Couldn't delete principal: ${formatApiError(err)}`);
		}
	}

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						Delete <code>{principal?.principalId}</code>?
					</DialogTitle>
					<DialogDescription>
						Documents that referenced this principal in their{" "}
						<code>visible_to</code> set will continue to do so — they just won't
						match any caller.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={confirm}
						disabled={del.isPending}
						className={cn(del.isPending && "opacity-60")}
					>
						{del.isPending ? "Deleting…" : "Delete"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

interface EditPrincipalDialogProps {
	readonly workspace: string;
	readonly principal: PrincipalRecord | null;
	readonly onClose: () => void;
}

/**
 * Edit a principal's label + attributes.
 *
 * The `principalId` itself is intentionally read-only here. Renaming
 * a principal would orphan every `visible_to` entry that referenced
 * the old name — a separate "rename + walk visible_to" route is
 * required for that, and the prototype doesn't have one yet. For
 * now: change the human-readable label, edit attributes, delete +
 * recreate if the id needs to change.
 */
function EditPrincipalDialog({
	workspace,
	principal,
	onClose,
}: EditPrincipalDialogProps) {
	const update = useUpdatePrincipal(workspace, principal?.principalId ?? "");
	const open = principal !== null;

	const [label, setLabel] = useState<string>(principal?.label ?? "");
	const [attrLines, setAttrLines] = useState<string>(
		serializeAttributes(principal?.attributes),
	);
	const principalId = principal?.principalId;
	const principalLabel = principal?.label;
	const principalAttributes = principal?.attributes;

	// Sync local form state when the parent flips between principals
	// (open Alice, close, open Bob — both should preload the right
	// values without a remount).
	useEffect(() => {
		if (principalId === undefined) {
			setLabel("");
			setAttrLines("");
			return;
		}
		setLabel(principalLabel ?? "");
		setAttrLines(serializeAttributes(principalAttributes));
	}, [principalId, principalLabel, principalAttributes]);

	function parseAttributes(text: string): Record<string, string> {
		const out: Record<string, string> = {};
		for (const line of text.split(/\r?\n/)) {
			const idx = line.indexOf("=");
			if (idx < 1) continue;
			const k = line.slice(0, idx).trim();
			const v = line.slice(idx + 1).trim();
			if (k.length > 0) out[k] = v;
		}
		return out;
	}

	async function submit(e: React.FormEvent): Promise<void> {
		e.preventDefault();
		if (!principal) return;
		try {
			await update.mutateAsync({
				label: label.trim() || null,
				attributes: parseAttributes(attrLines),
			});
			toast.success(`Updated principal '${principal.principalId}'`);
			onClose();
		} catch (err) {
			toast.error(`Couldn't update principal: ${formatApiError(err)}`);
		}
	}

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Edit principal</DialogTitle>
					<DialogDescription>
						Change the display label or attributes for{" "}
						<code>{principal?.principalId}</code>. The principal id itself can't
						be renamed here — delete + recreate if you need a different id.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} className="space-y-3">
					<label className="block space-y-1 text-sm">
						<span className="font-medium">Principal id</span>
						<input
							readOnly
							disabled
							value={principal?.principalId ?? ""}
							className="w-full rounded border border-slate-300 bg-slate-100 px-2 py-1 font-mono text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
						/>
					</label>
					<label className="block space-y-1 text-sm">
						<span className="font-medium">Label (optional)</span>
						<input
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="Alice Anderson"
							className="w-full rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
						/>
					</label>
					<label className="block space-y-1 text-sm">
						<span className="font-medium">Attributes</span>
						<textarea
							value={attrLines}
							onChange={(e) => setAttrLines(e.target.value)}
							placeholder={"role=viewer\ndept=finance"}
							rows={3}
							className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
						/>
						<span className="text-slate-500 text-xs">
							One <code>key=value</code> per line. Referenced from the policy
							DSL as <code>$principal.&lt;key&gt;</code>.
						</span>
					</label>
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" variant="brand" disabled={update.isPending}>
							{update.isPending ? "Saving…" : "Save changes"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function serializeAttributes(
	attributes: Readonly<Record<string, string>> | undefined,
): string {
	if (!attributes) return "";
	return Object.entries(attributes)
		.map(([k, v]) => `${k}=${v}`)
		.join("\n");
}
