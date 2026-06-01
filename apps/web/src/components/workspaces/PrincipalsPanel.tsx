import { Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from "@/components/common/states";
import { Button } from "@/components/ui/button";
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
} from "@/hooks/useRlac";
import { formatApiError } from "@/lib/api";
import {
	CreatePrincipalInputSchema,
	type Principal,
	type PrincipalRole,
} from "@/lib/schemas";

const TEXT_INPUT_CLASS =
	"w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900";

/**
 * RLAC principals registry (0.5.0 P4). A principal is an identity that
 * can appear in a document's `visible_to` set. The default policy DSL
 * also grants universal read to any principal carrying `admin: "true"`,
 * surfaced here as the "admin bypass" toggle on create.
 */
export function PrincipalsPanel({ workspace }: { workspace: string }) {
	const principals = usePrincipals(workspace);
	const [createOpen, setCreateOpen] = useState(false);
	const [toDelete, setToDelete] = useState<Principal | null>(null);

	if (principals.isLoading) return <LoadingState label="Loading principals…" />;
	if (principals.isError)
		return (
			<ErrorState
				title="Couldn't load principals"
				message={formatApiError(principals.error)}
			/>
		);

	const rows = [...(principals.data ?? [])];

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-end">
				<Button variant="brand" onClick={() => setCreateOpen(true)}>
					<Plus className="h-4 w-4" />
					Add principal
				</Button>
			</div>

			{rows.length === 0 ? (
				<EmptyState
					icon={<Users className="h-8 w-8" />}
					title="No principals yet"
					description="Add the identities that can be listed in a document's visibility set. An 'admin'-attributed principal sees every document."
				/>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead className="border-slate-200 border-b text-xs text-slate-500 uppercase tracking-wide dark:border-slate-700 dark:text-slate-400">
							<tr>
								<th className="pb-2 pr-3">Principal</th>
								<th className="pb-2 pr-3">Label</th>
								<th className="pb-2 pr-3">Role</th>
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
									<td className="py-2 pr-3 text-slate-600 dark:text-slate-400">
										{p.label ?? (
											<span className="text-slate-400 dark:text-slate-500">
												—
											</span>
										)}
									</td>
									<td className="py-2 pr-3 text-slate-600 dark:text-slate-400">
										{p.role}
									</td>
									<td className="py-2 pr-3 text-xs text-slate-600 dark:text-slate-400">
										{Object.keys(p.attributes).length === 0 ? (
											<span className="text-slate-400 dark:text-slate-500">
												—
											</span>
										) : (
											Object.entries(p.attributes)
												.map(([k, v]) => `${k}=${v}`)
												.join(", ")
										)}
									</td>
									<td className="py-2 text-right">
										<Button
											variant="ghost"
											size="icon"
											aria-label={`Delete ${p.principalId}`}
											onClick={() => setToDelete(p)}
										>
											<Trash2 className="h-4 w-4 text-red-600" />
										</Button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<CreatePrincipalDialog
				workspace={workspace}
				open={createOpen}
				onOpenChange={setCreateOpen}
			/>
			<DeletePrincipalDialog
				workspace={workspace}
				principal={toDelete}
				onClose={() => setToDelete(null)}
			/>
		</div>
	);
}

function CreatePrincipalDialog({
	workspace,
	open,
	onOpenChange,
}: {
	workspace: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const create = useCreatePrincipal(workspace);
	const [principalId, setPrincipalId] = useState("");
	const [label, setLabel] = useState("");
	const [role, setRole] = useState<PrincipalRole>("viewer");
	const [adminBypass, setAdminBypass] = useState(false);

	function reset() {
		setPrincipalId("");
		setLabel("");
		setRole("viewer");
		setAdminBypass(false);
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		const candidate = {
			principalId: principalId.trim(),
			label: label.trim() || null,
			role,
			...(adminBypass ? { attributes: { admin: "true" } } : {}),
		};
		const parsed = CreatePrincipalInputSchema.safeParse(candidate);
		if (!parsed.success) {
			toast.error(
				`Invalid principal: ${parsed.error.issues[0]?.message ?? "check the fields"}`,
			);
			return;
		}
		try {
			await create.mutateAsync(parsed.data);
			toast.success(`Created principal '${candidate.principalId}'`);
			reset();
			onOpenChange(false);
		} catch (err) {
			toast.error(`Couldn't create principal: ${formatApiError(err)}`);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Add principal</DialogTitle>
					<DialogDescription>
						An identity that can be listed in a document's visibility set. The
						id is what you put in a document's <code>visibleTo</code> list.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} className="space-y-3">
					<div className="space-y-1 text-sm">
						<label htmlFor="principal-id" className="font-medium">
							Principal id
						</label>
						<input
							id="principal-id"
							required
							autoFocus
							value={principalId}
							onChange={(e) => setPrincipalId(e.target.value)}
							placeholder="alice"
							className={`${TEXT_INPUT_CLASS} font-mono`}
						/>
						<span className="block text-slate-500 text-xs">
							Letters, numbers, and . _ : - (no spaces). Often a username or an
							API-key label.
						</span>
					</div>
					<div className="space-y-1 text-sm">
						<label htmlFor="principal-label" className="font-medium">
							Label (optional)
						</label>
						<input
							id="principal-label"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="Alice Lovelace"
							className={TEXT_INPUT_CLASS}
						/>
					</div>
					<div className="space-y-1 text-sm">
						<label htmlFor="principal-role" className="font-medium">
							Role
						</label>
						<select
							id="principal-role"
							value={role}
							onChange={(e) => setRole(e.target.value as PrincipalRole)}
							className={TEXT_INPUT_CLASS}
						>
							<option value="viewer">viewer</option>
							<option value="editor">editor</option>
							<option value="admin">admin</option>
						</select>
					</div>
					<label className="flex items-start gap-2 text-sm">
						<input
							type="checkbox"
							checked={adminBypass}
							onChange={(e) => setAdminBypass(e.target.checked)}
							className="mt-0.5 h-4 w-4"
						/>
						<span>
							<span className="font-medium">Admin bypass</span>
							<span className="block text-slate-500 text-xs">
								Sets <code>admin=true</code> — the default policy grants this
								principal read access to every document.
							</span>
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

function DeletePrincipalDialog({
	workspace,
	principal,
	onClose,
}: {
	workspace: string;
	principal: Principal | null;
	onClose: () => void;
}) {
	const del = useDeletePrincipal(workspace);
	const open = principal !== null;

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
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						Delete <code>{principal?.principalId}</code>?
					</DialogTitle>
					<DialogDescription>
						Documents that list this principal in their visibility set will no
						longer be readable by it. This cannot be undone.
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
					>
						{del.isPending ? "Deleting…" : "Delete"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
