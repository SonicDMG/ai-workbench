import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useApiKeys, useRevokeApiKey } from "@/hooks/useApiKeys";
import { formatApiError } from "@/lib/api";
import type { ApiKeyRecord } from "@/lib/schemas";
import { cn, formatDate } from "@/lib/utils";
import { CreateApiKeyDialog } from "./CreateApiKeyDialog";

/**
 * Workspace-scoped API-key management. Lives on the workspace
 * detail page, below the connection probe.
 *
 * Three visible operations:
 *   - Create: opens CreateApiKeyDialog (two-phase: label → reveal).
 *   - List: renders a table with label, prefix, status, and
 *     last-used.
 *   - Revoke: per-row button with a type-to-confirm dialog (same
 *     pattern as DeleteDialog for workspaces).
 */
export function ApiKeysPanel({ workspace }: { workspace: string }) {
	const keys = useApiKeys(workspace);
	const [createOpen, setCreateOpen] = useState(false);
	const [toRevoke, setToRevoke] = useState<ApiKeyRecord | null>(null);

	if (keys.isLoading) return <LoadingState label="Loading API keys…" />;
	if (keys.isError) {
		return (
			<ErrorState
				title="Couldn't load API keys"
				message={keys.error.message}
				actions={
					<Button variant="secondary" onClick={() => keys.refetch()}>
						<RefreshCw className="h-4 w-4" />
						Retry
					</Button>
				}
			/>
		);
	}

	const rows = keys.data ?? [];
	const activeCount = rows.filter((r) => r.revokedAt === null).length;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start justify-between gap-3 flex-wrap">
				<div>
					<p className="text-sm font-medium text-slate-900">API keys</p>
					<p className="text-xs text-slate-500 leading-relaxed mt-0.5">
						Workspace-scoped bearer tokens. Clients send them as{" "}
						<code className="font-mono">Authorization: Bearer wb_live_…</code>.
						{rows.length === 0
							? " No keys yet."
							: ` ${activeCount} active · ${rows.length} total (including revoked).`}
					</p>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<Button
						variant="ghost"
						size="icon"
						onClick={() => keys.refetch()}
						disabled={keys.isFetching}
						aria-label="Refresh keys"
					>
						<RefreshCw
							className={cn("h-4 w-4", keys.isFetching && "animate-spin")}
						/>
					</Button>
					<Button variant="brand" onClick={() => setCreateOpen(true)}>
						<Plus className="h-4 w-4" />
						New key
					</Button>
				</div>
			</div>

			{rows.length === 0 ? (
				<Card>
					<CardContent className="py-6 text-center text-sm text-slate-500">
						No keys yet. Create one to let a client authenticate against this
						workspace.
					</CardContent>
				</Card>
			) : (
				<div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
					<table className="w-full text-sm">
						<thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
							<tr>
								<th className="px-4 py-2 font-medium">Label</th>
								<th className="px-4 py-2 font-medium">Prefix</th>
								<th className="px-4 py-2 font-medium">Status</th>
								<th className="px-4 py-2 font-medium">Last used</th>
								<th className="px-4 py-2 font-medium">Created</th>
								<th className="px-2 py-2 sr-only">Actions</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{rows.map((row) => (
								<tr key={row.keyId} className="text-slate-800">
									<td className="px-4 py-2 font-medium">{row.label}</td>
									<td className="px-4 py-2 font-mono text-xs text-slate-600">
										wb_live_{row.prefix}_…
									</td>
									<td className="px-4 py-2">
										<StatusBadge row={row} />
									</td>
									<td className="px-4 py-2 text-slate-600">
										{row.lastUsedAt ? formatDate(row.lastUsedAt) : "—"}
									</td>
									<td className="px-4 py-2 text-slate-600">
										{formatDate(row.createdAt)}
									</td>
									<td className="px-2 py-2 text-right">
										{row.revokedAt === null ? (
											<Button
												variant="ghost"
												size="icon"
												aria-label={`Revoke ${row.label}`}
												onClick={() => setToRevoke(row)}
											>
												<Trash2 className="h-4 w-4 text-red-600" />
											</Button>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<CreateApiKeyDialog
				workspace={workspace}
				open={createOpen}
				onOpenChange={setCreateOpen}
			/>
			<RevokeDialog
				workspace={workspace}
				target={toRevoke}
				onClose={() => setToRevoke(null)}
			/>
		</div>
	);
}

function StatusBadge({ row }: { row: ApiKeyRecord }) {
	const now = new Date().toISOString();
	if (row.revokedAt !== null) {
		return <Badge tone="muted">Revoked</Badge>;
	}
	if (row.expiresAt !== null && row.expiresAt <= now) {
		return <Badge tone="amber">Expired</Badge>;
	}
	return <Badge tone="green">Active</Badge>;
}

function Badge({
	tone,
	children,
}: {
	tone: "green" | "amber" | "muted";
	children: React.ReactNode;
}) {
	const styles: Record<typeof tone, string> = {
		green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
		amber: "bg-amber-50 text-amber-700 ring-amber-200",
		muted: "bg-slate-100 text-slate-600 ring-slate-200",
	};
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
				styles[tone],
			)}
		>
			{children}
		</span>
	);
}

function RevokeDialog({
	workspace,
	target,
	onClose,
}: {
	workspace: string;
	target: ApiKeyRecord | null;
	onClose: () => void;
}) {
	const revoke = useRevokeApiKey(workspace);

	return (
		<Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						Revoke API key{target ? ` '${target.label}'` : ""}?
					</DialogTitle>
					<DialogDescription>
						This takes effect immediately — the next request bearing this token
						gets a <code className="font-mono">401 unauthorized</code>. The key
						row stays in the list (with{" "}
						<code className="font-mono">revokedAt</code> set) for audit
						purposes.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose} disabled={revoke.isPending}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						disabled={!target || revoke.isPending}
						onClick={async () => {
							if (!target) return;
							try {
								await revoke.mutateAsync(target.keyId);
								toast.success(`Key '${target.label}' revoked`);
								onClose();
							} catch (err) {
								toast.error("Couldn't revoke key", {
									description: formatApiError(err),
								});
							}
						}}
					>
						{revoke.isPending ? "Revoking…" : "Revoke key"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
