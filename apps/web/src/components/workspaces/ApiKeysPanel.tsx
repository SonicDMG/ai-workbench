import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from "@/components/common/states";
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
				message={formatApiError(keys.error)}
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
		<Card className="overflow-hidden shadow-sm">
			<CardHeader className="flex flex-col items-stretch gap-4 space-y-0 bg-slate-50/70 p-4 sm:flex-row sm:items-start sm:justify-between dark:bg-slate-900/60">
				<div className="flex min-w-0 items-start gap-3">
					<SectionIcon>
						<KeyRound className="h-4 w-4" />
					</SectionIcon>
					<div className="min-w-0">
						<CardTitle className="text-base">API keys</CardTitle>
						<p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
							Bearer tokens; sent as{" "}
							<code className="font-mono">Authorization: Bearer wb_live_…</code>
							.
							{rows.length === 0
								? " No keys yet."
								: ` ${activeCount} active · ${rows.length} total.`}
						</p>
					</div>
				</div>
				<div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
					<Button
						variant="ghost"
						size="icon"
						className="shrink-0"
						onClick={() => keys.refetch()}
						disabled={keys.isFetching}
						aria-label="Refresh keys"
					>
						<RefreshCw
							className={cn("h-4 w-4", keys.isFetching && "animate-spin")}
						/>
					</Button>
					<Button
						variant="brand"
						className="min-w-0 flex-1 sm:flex-none"
						onClick={() => setCreateOpen(true)}
						title="Mint a workspace-scoped bearer token. Pick a role (Viewer / Editor / Admin) at creation; the secret value is shown exactly once after the key lands."
					>
						<Plus className="h-4 w-4" />
						New key
					</Button>
				</div>
			</CardHeader>
			<CardContent className="p-4 pt-3">
				{rows.length === 0 ? (
					// No action button here — the always-visible "New key" button
					// in the header is the canonical CTA; duplicating it in the
					// empty state is redundant.
					<EmptyState
						icon={<KeyRound className="h-8 w-8" />}
						title="No keys yet"
						description="Create one to let a client authenticate against this workspace."
					/>
				) : (
					/*
					 * `overflow-x-auto` (not `overflow-hidden`) on the wrapper
					 * — the table has 7 columns and lives in the right-rail of
					 * a 2-column workspace layout, so it WILL spill past its
					 * parent on narrow viewports. Clipping silently dropped
					 * the right edge ("Scope" → "SCOR"); scrolling preserves
					 * every cell and surfaces the overflow as an actual
					 * scrollbar. `min-w-[640px]` keeps columns from squishing
					 * the badges into unreadable widths before the scrollbar
					 * appears. */
					<div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
						<table className="w-full min-w-[640px] text-sm">
							<thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
								<tr>
									<th className="whitespace-nowrap px-4 py-2 font-medium">
										Label
									</th>
									<th className="whitespace-nowrap px-4 py-2 font-medium">
										Prefix
									</th>
									<th className="whitespace-nowrap px-4 py-2 font-medium">
										Scopes
									</th>
									<th className="whitespace-nowrap px-4 py-2 font-medium">
										Status
									</th>
									<th className="whitespace-nowrap px-4 py-2 font-medium">
										Last used
									</th>
									<th className="whitespace-nowrap px-4 py-2 font-medium">
										Created
									</th>
									<th className="px-2 py-2 sr-only">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100 dark:divide-slate-800">
								{rows.map((row) => (
									<tr
										key={row.keyId}
										className="text-slate-800 dark:text-slate-100"
									>
										<td className="whitespace-nowrap px-4 py-2 font-medium">
											{row.label}
										</td>
										<td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
											wb_live_{row.prefix}_…
										</td>
										<td className="whitespace-nowrap px-4 py-2">
											<ScopeBadges scopes={row.scopes} />
										</td>
										<td className="whitespace-nowrap px-4 py-2">
											<StatusBadge row={row} />
										</td>
										<td className="whitespace-nowrap px-4 py-2 text-slate-600 dark:text-slate-400">
											{row.lastUsedAt ? formatDate(row.lastUsedAt) : "—"}
										</td>
										<td className="whitespace-nowrap px-4 py-2 text-slate-600 dark:text-slate-400">
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
			</CardContent>
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
		</Card>
	);
}

/**
 * Renders the key's privilege tier as a single human-readable badge.
 * The wire format is a scope array (`["read"]`, `["read", "write"]`,
 * `["read", "write", "manage"]`) but the UI's mental model is the same
 * role picker the create dialog exposes — so we collapse to a role
 * label here. Keeps the picker → table read consistent.
 *
 * Branches, most-privileged first:
 *   - any set containing `manage` → "Admin", red — the highest tier
 *     (can mint keys / manage RLAC / delete the workspace), so it
 *     should read as the loudest.
 *   - `["read", "write"]`         → "Editor", amber; write keys carry
 *     more risk than read-only ones.
 *   - exactly `["read"]`          → "Viewer", subdued green.
 *   - anything else (legacy / future preset) → fall back to a chip per
 *     literal scope. Defensive; renders unexpected scopes verbatim
 *     without us having to revisit this.
 */
/**
 * Tone for a single scope chip, by tier (0.5.0 fine scopes). Manage-tier
 * grants read loudest (red); write-tier + `tools:invoke` (external-tool
 * invocation is a side-effecting capability) are amber; read-tier is the
 * subdued green. Matches the coarse-tier colors so a fine `write:ingest`
 * chip reads the same risk weight as a coarse `write` badge.
 */
function scopeTone(scope: string): "red" | "amber" | "green" {
	if (scope === "manage" || scope.startsWith("manage:")) return "red";
	if (
		scope === "write" ||
		scope.startsWith("write:") ||
		scope === "tools:invoke"
	)
		return "amber";
	return "green";
}

function ScopeBadges({ scopes }: { scopes: readonly string[] }) {
	if (scopes.length === 0) {
		// Defensive — should not happen given the route's min(1) gate,
		// but rendering "—" is friendlier than blank if it ever does.
		return <span className="text-xs text-slate-400">—</span>;
	}
	const hasManage = scopes.includes("manage");
	const hasWrite = scopes.includes("write");
	const isViewer = scopes.length === 1 && scopes[0] === "read";
	const isEditor =
		scopes.length === 2 && scopes.includes("read") && hasWrite && !hasManage;
	const isAdmin =
		hasManage && hasWrite && scopes.includes("read") && scopes.length === 3;

	if (isAdmin) {
		return <Badge tone="red">Admin</Badge>;
	}
	if (isEditor) {
		return <Badge tone="amber">Editor</Badge>;
	}
	if (isViewer) {
		return <Badge tone="green">Viewer</Badge>;
	}
	return (
		<span className="flex flex-wrap gap-1">
			{scopes.map((scope) => (
				<Badge key={scope} tone={scopeTone(scope)}>
					{scope}
				</Badge>
			))}
		</span>
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
	tone: "green" | "amber" | "red" | "muted";
	children: React.ReactNode;
}) {
	const styles: Record<typeof tone, string> = {
		green:
			"bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50",
		amber:
			"bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50",
		red: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/50",
		muted:
			"bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700",
	};
	return (
		<span
			className={cn(
				// `whitespace-nowrap` is the load-bearing class — without
				// it a narrow column (the API-keys table on a side panel,
				// the workspace list squeezed by a sidebar) wraps multi-
				// word labels like "Read only" or "Read + Write" across
				// two lines inside the pill, which then gets vertically
				// clipped by the row height. Pills should always be a
				// single line.
				"inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
				styles[tone],
			)}
		>
			{children}
		</span>
	);
}

function SectionIcon({ children }: { children: React.ReactNode }) {
	return (
		<div
			aria-hidden="true"
			className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
		>
			{children}
		</div>
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
