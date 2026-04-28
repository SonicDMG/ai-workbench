import { ArrowLeft, ExternalLink, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { CopyButton } from "@/components/common/CopyButton";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiKeysPanel } from "@/components/workspaces/ApiKeysPanel";
import { DeleteDialog } from "@/components/workspaces/DeleteDialog";
import { KindBadge } from "@/components/workspaces/KindBadge";
import { KnowledgeBasesPanel } from "@/components/workspaces/KnowledgeBasesPanel";
import { ServicesPanel } from "@/components/workspaces/ServicesPanel";
import { TestConnectionPanel } from "@/components/workspaces/TestConnectionPanel";
import { WorkspaceForm } from "@/components/workspaces/WorkspaceForm";
import {
	useDeleteWorkspace,
	useUpdateWorkspace,
	useWorkspace,
} from "@/hooks/useWorkspaces";
import { ApiError, formatApiError } from "@/lib/api";
import { formatDate } from "@/lib/utils";

function isLiteralUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

export function WorkspaceDetailPage() {
	const { workspaceUid } = useParams<{ workspaceUid: string }>();
	const navigate = useNavigate();
	const { data, isLoading, isError, error } = useWorkspace(workspaceUid);
	const update = useUpdateWorkspace(workspaceUid ?? "");
	const del = useDeleteWorkspace();
	const [editing, setEditing] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	if (!workspaceUid) return <Navigate to="/" replace />;
	if (isLoading) return <LoadingState label="Loading workspace…" />;
	if (isError || !data) {
		const message =
			error instanceof ApiError && error.code === "workspace_not_found"
				? "This workspace doesn't exist or was deleted."
				: formatApiError(error);
		return (
			<ErrorState
				title="Couldn't load workspace"
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
				<Link to="/">
					<ArrowLeft className="h-4 w-4" />
					All workspaces
				</Link>
			</Button>

			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex items-center gap-3 flex-wrap">
						<h1 className="text-2xl font-semibold tracking-tight text-slate-900 truncate">
							{data.name}
						</h1>
						<KindBadge kind={data.kind} />
					</div>
					<div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
						<span className="font-mono truncate">{data.workspaceId}</span>
						<CopyButton value={data.workspaceId} label="Copy workspace id" />
					</div>
				</div>
				<div className="flex shrink-0 flex-col items-end gap-2">
					<div className="flex items-center gap-2">
						{!editing ? <TestConnectionPanel uid={data.workspaceId} /> : null}
						{editing ? (
							<Button variant="ghost" onClick={() => setEditing(false)}>
								<X className="h-4 w-4" />
								Cancel edit
							</Button>
						) : (
							<Button variant="secondary" onClick={() => setEditing(true)}>
								<Pencil className="h-4 w-4" />
								Edit
							</Button>
						)}
						<Button variant="destructive" onClick={() => setDeleteOpen(true)}>
							<Trash2 className="h-4 w-4" />
							Delete
						</Button>
					</div>
				</div>
			</div>

			{editing ? (
				<Card>
					<CardHeader>
						<CardTitle>Edit workspace</CardTitle>
					</CardHeader>
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
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>Details</CardTitle>
					</CardHeader>
					<CardContent>
						<dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-6 gap-y-3 text-sm">
							<dt className="text-slate-500">Name</dt>
							<dd className="text-slate-900">{data.name}</dd>

							<dt className="text-slate-500">Kind</dt>
							<dd className="text-slate-900 font-mono text-xs">{data.kind}</dd>

							<dt className="text-slate-500">Keyspace</dt>
							<dd className="text-slate-900 font-mono">
								{data.keyspace ?? <span className="text-slate-400">—</span>}
							</dd>

							<dt className="text-slate-500">Url</dt>
							<dd className="text-slate-900 truncate">
								{data.url ? (
									isLiteralUrl(data.url) ? (
										<a
											href={data.url}
											target="_blank"
											rel="noreferrer"
											className="inline-flex items-center gap-1 font-mono text-xs text-[var(--color-brand-600)] hover:underline"
										>
											{data.url}
											<ExternalLink className="h-3 w-3" />
										</a>
									) : (
										<code className="font-mono text-xs text-slate-700">
											{data.url}
										</code>
									)
								) : (
									<span className="text-slate-400">—</span>
								)}
							</dd>

							<dt className="text-slate-500">Credentials</dt>
							<dd>
								{Object.keys(data.credentials).length === 0 ? (
									<span className="text-slate-400">—</span>
								) : (
									<ul className="flex flex-col gap-1">
										{Object.entries(data.credentials).map(([key, ref]) => (
											<li
												key={key}
												className="flex items-baseline gap-2 text-slate-900"
											>
												<span className="font-medium">{key}</span>
												<span className="text-slate-400">→</span>
												<code className="font-mono text-xs text-slate-600">
													{ref}
												</code>
												<CopyButton
													value={ref}
													label={`Copy ${key} secret ref`}
												/>
											</li>
										))}
									</ul>
								)}
							</dd>

							<dt className="text-slate-500">Created</dt>
							<dd className="text-slate-900">{formatDate(data.createdAt)}</dd>

							<dt className="text-slate-500">Updated</dt>
							<dd className="text-slate-900">{formatDate(data.updatedAt)}</dd>
						</dl>
					</CardContent>
				</Card>
			)}

			{!editing ? (
				<>
					<Card>
						<CardContent className="pt-5">
							<ServicesPanel workspace={data.workspaceId} />
						</CardContent>
					</Card>
					<Card>
						<CardContent className="pt-5">
							<KnowledgeBasesPanel workspace={data.workspaceId} />
						</CardContent>
					</Card>
					<Card>
						<CardContent className="pt-5">
							<ApiKeysPanel workspace={data.workspaceId} />
						</CardContent>
					</Card>
				</>
			) : null}

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
