import {
	ArrowLeft,
	Cog,
	Database,
	ExternalLink,
	KeyRound,
	Pencil,
	Sparkles,
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
import { ApiKeysPanel } from "@/components/workspaces/ApiKeysPanel";
import { DeleteDialog } from "@/components/workspaces/DeleteDialog";
import { KindBadge } from "@/components/workspaces/KindBadge";
import { KnowledgeBasesPanel } from "@/components/workspaces/KnowledgeBasesPanel";
import { McpUrlButton } from "@/components/workspaces/McpUrlButton";
import { ServicesPanel } from "@/components/workspaces/ServicesPanel";
import { TestConnectionPanel } from "@/components/workspaces/TestConnectionPanel";
import { WorkspaceForm } from "@/components/workspaces/WorkspaceForm";
import { useFeatures } from "@/hooks/useFeatures";
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

export function WorkspaceDetailPage() {
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const navigate = useNavigate();
	const { data, isLoading, isError, error } = useWorkspace(workspaceId);
	const update = useUpdateWorkspace(workspaceId ?? "");
	const del = useDeleteWorkspace();
	const features = useFeatures();
	const mcpBaseUrl =
		features.data?.mcp.enabled === true ? features.data.mcp.baseUrl : null;
	const [editing, setEditing] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	if (!workspaceId) return <Navigate to="/" replace />;
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
						{!editing ? (
							<>
								<Button variant="brand" asChild>
									<Link to={`/workspaces/${data.workspaceId}/agents`}>
										<Sparkles className="h-4 w-4" />
										Agents
									</Link>
								</Button>
								{mcpBaseUrl ? (
									<McpUrlButton
										workspaceId={data.workspaceId}
										baseUrl={mcpBaseUrl}
									/>
								) : null}
								<div
									aria-hidden="true"
									className="mx-1 h-6 w-px bg-slate-200"
								/>
								<TestConnectionPanel workspaceId={data.workspaceId} />
							</>
						) : null}
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
				<>
					<MetadataStrip workspace={data} />

					<KnowledgeBaseHero workspaceId={data.workspaceId} />

					<div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
						<Card className="lg:col-span-2">
							<CardHeader className="flex-row items-center gap-3 pb-3">
								<SectionIcon tone="slate">
									<Cog className="h-4 w-4" />
								</SectionIcon>
								<CardTitle>Execution services</CardTitle>
							</CardHeader>
							<CardContent>
								<ServicesPanel workspace={data.workspaceId} />
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="flex-row items-center gap-3 pb-3">
								<SectionIcon tone="slate">
									<KeyRound className="h-4 w-4" />
								</SectionIcon>
								<CardTitle>API keys</CardTitle>
							</CardHeader>
							<CardContent>
								<ApiKeysPanel workspace={data.workspaceId} />
							</CardContent>
						</Card>
					</div>
				</>
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

/**
 * At-a-glance horizontal strip replacing the old `Details` card.
 *
 * Shows the high-cardinality workspace metadata (kind, keyspace, url,
 * timestamps) inline with subtle dividers — no card chrome — so the
 * KB hero below can carry the visual weight.
 *
 * Credentials get their own row beneath since they're variable-height
 * and would push the strip's alignment around if inlined.
 */
function MetadataStrip({ workspace }: { workspace: Workspace }) {
	const credentialEntries = Object.entries(workspace.credentials);
	return (
		<section
			aria-label="Workspace details"
			className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm"
		>
			<dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 sm:divide-x sm:divide-slate-100">
				<MetaCell label="Keyspace">
					{workspace.keyspace ? (
						<code className="font-mono text-sm text-slate-900">
							{workspace.keyspace}
						</code>
					) : (
						<span className="text-slate-400">—</span>
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
							<code className="block truncate font-mono text-sm text-slate-900">
								{workspace.url}
							</code>
						)
					) : (
						<span className="text-slate-400">—</span>
					)}
				</MetaCell>
				<MetaCell label="Created">
					<span className="text-sm text-slate-900">
						{formatDate(workspace.createdAt)}
					</span>
				</MetaCell>
				<MetaCell label="Updated">
					<span className="text-sm text-slate-900">
						{formatDate(workspace.updatedAt)}
					</span>
				</MetaCell>
			</dl>
			{credentialEntries.length > 0 ? (
				<div className="mt-4 border-t border-slate-100 pt-3">
					<p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
						Credentials
					</p>
					<ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
						{credentialEntries.map(([key, ref]) => (
							<li
								key={key}
								className="flex items-baseline gap-1.5 text-sm text-slate-700"
							>
								<span className="font-medium">{key}</span>
								<span className="text-slate-400">→</span>
								<code className="font-mono text-xs text-slate-600">{ref}</code>
								<CopyButton value={ref} label={`Copy ${key} secret ref`} />
							</li>
						))}
					</ul>
				</div>
			) : null}
		</section>
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
			<dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
				{label}
			</dt>
			<dd className="min-w-0 truncate">{children}</dd>
		</div>
	);
}

/**
 * Visual treatment for the page's main attraction. The KB panel is
 * substantive enough that wrapping it in a plain Card felt
 * underweighted next to the (lighter) Services and API-keys cards.
 *
 * Treatment:
 *   - subtle brand-tinted top border so the section reads as the
 *     primary surface even when scrolled past
 *   - icon-prefixed heading with a one-line subtitle
 *   - generous internal padding
 *
 * The heavy lifting (KB CRUD, ingest, doc list) lives unchanged in
 * `KnowledgeBasesPanel` — only the chrome around it changes.
 */
function KnowledgeBaseHero({ workspaceId }: { workspaceId: string }) {
	return (
		<Card className="overflow-hidden border-t-2 border-t-[var(--color-brand-500)] shadow-sm">
			<CardHeader className="gap-1 bg-gradient-to-b from-[var(--color-brand-50)]/60 to-white pb-4">
				<div className="flex items-center gap-3">
					<SectionIcon tone="brand">
						<Database className="h-4 w-4" />
					</SectionIcon>
					<CardTitle className="text-lg">Knowledge bases</CardTitle>
				</div>
				<p className="text-sm text-slate-600 pl-11">
					Vector collections this workspace serves to agents and the retrieval
					playground. Each KB binds chunking, embedding, and (optional)
					reranking services.
				</p>
			</CardHeader>
			<CardContent className="pt-2">
				<KnowledgeBasesPanel workspace={workspaceId} />
			</CardContent>
		</Card>
	);
}

/**
 * Small colored square that sits next to a section title. Tones map to
 * the section's role: `brand` for the page's primary surface,
 * `slate` for secondary/utility surfaces.
 */
function SectionIcon({
	tone,
	children,
}: {
	tone: "brand" | "slate";
	children: React.ReactNode;
}) {
	const cls =
		tone === "brand"
			? "bg-[var(--color-brand-100)] text-[var(--color-brand-700)]"
			: "bg-slate-100 text-slate-600";
	return (
		<div
			aria-hidden="true"
			className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${cls}`}
		>
			{children}
		</div>
	);
}
