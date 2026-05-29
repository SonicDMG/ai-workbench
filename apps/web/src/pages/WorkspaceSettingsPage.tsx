import {
	ArrowLeft,
	Cog,
	ExternalLink,
	Info,
	Pencil,
	ServerCog,
	ShieldCheck,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { CopyButton } from "@/components/common/CopyButton";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ApiKeysPanel } from "@/components/workspaces/ApiKeysPanel";
import { DeleteDialog } from "@/components/workspaces/DeleteDialog";
import { KindBadge } from "@/components/workspaces/KindBadge";
import { PolicyAuditPanel } from "@/components/workspaces/PolicyAuditPanel";
import { PrincipalsPanel } from "@/components/workspaces/PrincipalsPanel";
import { SeededDefaultsCallout } from "@/components/workspaces/SeededDefaultsCallout";
import { ServicesPanel } from "@/components/workspaces/ServicesPanel";
import { TestConnectionPanel } from "@/components/workspaces/TestConnectionPanel";
import { WorkspaceForm } from "@/components/workspaces/WorkspaceForm";
import { useRole } from "@/hooks/useRole";
import {
	useDeleteWorkspace,
	useUpdateWorkspace,
	useWorkspace,
} from "@/hooks/useWorkspaces";
import { ApiError, formatApiError } from "@/lib/api";
import type { Workspace } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";

function isLiteralUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

export function WorkspaceSettingsPage() {
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const navigate = useNavigate();
	const { data, isLoading, isError, error } = useWorkspace(workspaceId);
	const update = useUpdateWorkspace(workspaceId ?? "");
	const del = useDeleteWorkspace();
	// RBAC gating: admin-only surfaces (API keys, RLAC controls, delete)
	// are hidden/disabled for non-admins. `canManage` defaults permissive
	// when there's no role signal (see useRole) — the server stays the
	// authoritative gate.
	const { canManage } = useRole();
	const [editing, setEditing] = useState(false);
	const [infoOpen, setInfoOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	if (!workspaceId) return <Navigate to="/" replace />;
	if (isLoading) return <LoadingState label="Loading workspace settings…" />;
	if (isError || !data) {
		const message =
			error instanceof ApiError && error.code === "workspace_not_found"
				? "This workspace doesn't exist or was deleted."
				: formatApiError(error);
		return (
			<ErrorState
				title="Couldn't load workspace settings"
				message={message}
				actions={
					<Button variant="secondary" asChild>
						<Link to="/">Back to workspaces</Link>
					</Button>
				}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<Button variant="ghost" size="sm" asChild className="-ml-3 self-start">
				<Link to={`/workspaces/${data.workspaceId}`}>
					<ArrowLeft className="h-4 w-4" />
					Back to workspace
				</Link>
			</Button>

			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
						Settings
					</h1>
					<p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
						{data.name} · credentials, services, keys, and workspace lifecycle.
					</p>
				</div>
			</div>

			<SeededDefaultsCallout workspace={data} />

			<Card>
				<CardHeader className="flex flex-col items-stretch gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex min-w-0 items-start gap-3 sm:items-center">
						<SectionIcon>
							<Cog className="h-4 w-4" />
						</SectionIcon>
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<CardTitle className="truncate">{data.name}</CardTitle>
								<KindBadge kind={data.kind} />
							</div>
							<p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
								Connection, metadata, and lifecycle controls.
							</p>
						</div>
					</div>
					<div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:flex-wrap sm:items-center sm:justify-end">
						<TestConnectionPanel
							workspaceId={data.workspaceId}
							className="col-span-2 justify-center sm:col-span-1"
						/>
						<Button
							variant="secondary"
							className="justify-center"
							onClick={() => setInfoOpen(true)}
						>
							<Info className="h-4 w-4" />
							Info
						</Button>
						{editing ? (
							<Button
								variant="ghost"
								className="justify-center"
								onClick={() => setEditing(false)}
							>
								<X className="h-4 w-4" />
								Cancel edit
							</Button>
						) : (
							<Button
								variant="secondary"
								className="justify-center"
								onClick={() => setEditing(true)}
							>
								<Pencil className="h-4 w-4" />
								Edit
							</Button>
						)}
						{canManage ? (
							<Button
								variant="destructive"
								className="col-span-2 justify-center sm:col-span-1"
								onClick={() => setDeleteOpen(true)}
							>
								<Trash2 className="h-4 w-4" />
								Delete
							</Button>
						) : null}
					</div>
				</CardHeader>
				{editing ? (
					<CardContent>
						<WorkspaceForm
							mode="edit"
							workspace={data}
							submitting={update.isPending}
							onCancel={() => setEditing(false)}
							onSubmit={async (patch) => {
								try {
									await update.mutateAsync(patch);
									toast.success("Workspace updated");
									setEditing(false);
								} catch (err) {
									toast.error("Couldn't save changes", {
										description: formatApiError(err),
									});
								}
							}}
						/>
					</CardContent>
				) : null}
			</Card>

			<WorkspaceInfoDialog
				open={infoOpen}
				onOpenChange={setInfoOpen}
				workspace={data}
			/>

			<SettingsSection
				title="Services"
				description="LLMs, embedders, chunkers, and rerankers available to agents and knowledge bases in this workspace."
				icon={<ServerCog className="h-4 w-4" />}
			>
				<ServicesPanel workspace={data.workspaceId} />
			</SettingsSection>

			{canManage ? (
				<>
					<ApiKeysPanel workspace={data.workspaceId} />

					<AccessControlToggle workspace={data} />

					{data.rlacEnabled ? (
						<>
							<PrincipalsPanel workspace={data.workspaceId} />
							<PolicyAuditPanel workspace={data.workspaceId} />
						</>
					) : null}
				</>
			) : (
				<AdminOnlyNote />
			)}

			<DeleteDialog
				open={deleteOpen}
				onOpenChange={setDeleteOpen}
				workspaceName={data.name}
				submitting={del.isPending}
				onConfirm={async () => {
					try {
						await del.mutateAsync(data.workspaceId);
						toast.success(`Workspace '${data.name}' deleted`);
						navigate("/");
					} catch (err) {
						toast.error("Couldn't delete workspace", {
							description: formatApiError(err),
						});
					}
				}}
			/>
		</div>
	);
}

function MetadataStrip({ workspace }: { workspace: Workspace }) {
	const credentialEntries = Object.entries(workspace.credentials);
	return (
		<div className="flex flex-col gap-4">
			<dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 sm:divide-x sm:divide-slate-100 sm:dark:divide-slate-800">
				<MetaCell label="Keyspace">
					{workspace.keyspace ? (
						<code className="font-mono text-sm text-slate-900 dark:text-slate-100">
							{workspace.keyspace}
						</code>
					) : (
						<span className="text-slate-400 dark:text-slate-500">-</span>
					)}
				</MetaCell>
				<MetaCell label="Url">
					{workspace.url ? (
						isLiteralUrl(workspace.url) ? (
							<a
								href={workspace.url}
								target="_blank"
								rel="noreferrer"
								className="inline-flex max-w-full items-center gap-1 truncate font-mono text-sm text-[var(--color-brand-600)] hover:underline"
							>
								<span className="truncate">{workspace.url}</span>
								<ExternalLink className="h-3 w-3 shrink-0" />
							</a>
						) : (
							<code className="block truncate font-mono text-sm text-slate-900 dark:text-slate-100">
								{workspace.url}
							</code>
						)
					) : (
						<span className="text-slate-400 dark:text-slate-500">-</span>
					)}
				</MetaCell>
				<MetaCell label="Created">
					<span className="text-sm text-slate-900 dark:text-slate-100">
						{formatDate(workspace.createdAt)}
					</span>
				</MetaCell>
				<MetaCell label="Updated">
					<span className="text-sm text-slate-900 dark:text-slate-100">
						{formatDate(workspace.updatedAt)}
					</span>
				</MetaCell>
			</dl>
			{credentialEntries.length > 0 ? (
				<div className="border-t border-slate-100 pt-3 dark:border-slate-800">
					<p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
						Credentials
					</p>
					<ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
						{credentialEntries.map(([key, ref]) => (
							<li
								key={key}
								className="flex items-baseline gap-1.5 text-sm text-slate-700 dark:text-slate-300"
							>
								<span className="font-medium">{key}</span>
								<span className="text-slate-400 dark:text-slate-500">=</span>
								<code className="font-mono text-xs text-slate-600 dark:text-slate-400">
									{ref}
								</code>
								<CopyButton value={ref} label={`Copy ${key} secret ref`} />
							</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
}

function WorkspaceInfoDialog({
	open,
	onOpenChange,
	workspace,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspace: Workspace;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl">
				<DialogHeader>
					<DialogTitle>Workspace info</DialogTitle>
					<DialogDescription>{workspace.name}</DialogDescription>
				</DialogHeader>
				<MetadataStrip workspace={workspace} />
			</DialogContent>
		</Dialog>
	);
}

function MetaCell({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5 sm:px-5 sm:first:pl-0 sm:last:pr-0">
			<dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
				{label}
			</dt>
			<dd className="min-w-0 truncate">{children}</dd>
		</div>
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

/**
 * Placeholder shown in place of the admin-only sections (API keys, RLAC
 * controls, principals, policy audit) when the signed-in caller isn't an
 * admin. Naming the gap is friendlier than silently dropping the cards —
 * a Viewer/Editor sees *why* the controls are absent rather than
 * wondering if the page failed to load.
 */
function AdminOnlyNote() {
	return (
		<Card className="overflow-hidden shadow-sm">
			<CardContent className="flex items-start gap-3 p-4 text-sm text-slate-600 dark:text-slate-400">
				<SectionIcon>
					<ShieldCheck className="h-4 w-4" />
				</SectionIcon>
				<div className="min-w-0">
					<p className="font-medium text-slate-800 dark:text-slate-200">
						Admin-only controls hidden
					</p>
					<p className="mt-1 leading-relaxed">
						API keys, access-control settings, and workspace deletion require
						the <code>manage</code> scope (the Admin role). Ask a workspace
						admin if you need access to these.
					</p>
				</div>
			</CardContent>
		</Card>
	);
}

function SettingsSection({
	title,
	description,
	icon,
	children,
}: {
	title: string;
	description?: string;
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<Card className="overflow-hidden shadow-sm">
			<CardHeader className="flex flex-row items-start gap-3 space-y-0 bg-slate-50/70 p-4 dark:bg-slate-900/60">
				<SectionIcon>{icon}</SectionIcon>
				<div className="min-w-0">
					<CardTitle className="text-base">{title}</CardTitle>
					{description ? (
						<p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
							{description}
						</p>
					) : null}
				</div>
			</CardHeader>
			<CardContent className="p-4 pt-3">{children}</CardContent>
		</Card>
	);
}

/**
 * Workspace-level RLAC master switch.
 *
 * The current model is binary: when off, every KB read returns
 * everything (no row filter, no audit emission). When on, every KB
 * read filters through the canonical visibility-list predicate, the
 * View-as picker appears in the KB header + ingest dialog, and the
 * Principals + Policy-audit panels appear below this card in the
 * settings page.
 *
 * Per-KB customization (Off / Visibility list / Custom DSL) used to
 * live in the KB explorer header. It's gone — one switch per
 * workspace is enough for the prototype's demo flow.
 */
function AccessControlToggle({ workspace }: { workspace: Workspace }) {
	const update = useUpdateWorkspace(workspace.workspaceId);

	async function flip(next: boolean): Promise<void> {
		try {
			await update.mutateAsync({ rlacEnabled: next });
			toast.success(
				next ? "Access control enabled" : "Access control disabled",
			);
		} catch (err) {
			toast.error(`Couldn't update access control: ${formatApiError(err)}`);
		}
	}

	return (
		<Card className="overflow-hidden shadow-sm">
			<CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 bg-slate-50/70 p-4 dark:bg-slate-900/60">
				<div className="flex min-w-0 items-start gap-3">
					<SectionIcon>
						<ShieldCheck className="h-4 w-4" />
					</SectionIcon>
					<div className="min-w-0">
						<CardTitle className="text-base">Access control</CardTitle>
						<p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
							Row-level access control. When on, every KB read is filtered
							against each document's <code>visible_to</code> list and the
							View-as picker, principal management, and audit log become
							available. When off, every member of the workspace sees every
							document.{" "}
							<a
								href="https://github.com/datastax/ai-workbench/blob/main/docs/rlac.md"
								target="_blank"
								rel="noreferrer"
								className="font-medium text-slate-700 hover:underline dark:text-slate-200"
							>
								Learn more →
							</a>
						</p>
					</div>
				</div>
				<label className="flex shrink-0 items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={workspace.rlacEnabled}
						onChange={(e) => void flip(e.target.checked)}
						disabled={update.isPending}
						className="h-4 w-4"
						aria-label="Enable access control"
					/>
					<span className="font-medium text-slate-700 dark:text-slate-200">
						{workspace.rlacEnabled ? "Enabled" : "Disabled"}
					</span>
				</label>
			</CardHeader>
		</Card>
	);
}
