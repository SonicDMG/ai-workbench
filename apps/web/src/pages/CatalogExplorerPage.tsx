import { ArrowLeft, FolderOpen, RefreshCw, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { DocumentDetailDialog } from "@/components/workspaces/DocumentDetailDialog";
import { DocumentTable } from "@/components/workspaces/DocumentTable";
import { IngestQueueDialog } from "@/components/workspaces/IngestQueueDialog";
import { SavedQueriesSection } from "@/components/workspaces/SavedQueriesSection";
import { useCatalogs } from "@/hooks/useCatalogs";
import { useDocuments } from "@/hooks/useDocuments";
import { useWorkspace } from "@/hooks/useWorkspaces";
import type { DocumentRecord } from "@/lib/schemas";

/**
 * Catalog explorer — `/workspaces/:wid/catalogs/:cid`. Shows the
 * documents in one catalog as a sortable, searchable table with
 * file-type badges, sizes, statuses, and an inline detail dialog.
 *
 * The "Ingest" button here pops the multi-file / folder queue; the
 * inline single-file ingest dialog still lives on the parent
 * workspace page for one-off uploads.
 */
export function CatalogExplorerPage() {
	const params = useParams<{ uid: string; catalogId: string }>();
	const workspaceId = params.uid;
	const catalogId = params.catalogId;

	const ws = useWorkspace(workspaceId);
	const catalogs = useCatalogs(workspaceId);
	const docs = useDocuments(workspaceId, catalogId);

	const catalog = useMemo(
		() => catalogs.data?.find((c) => c.uid === catalogId) ?? null,
		[catalogs.data, catalogId],
	);

	const [ingestOpen, setIngestOpen] = useState(false);
	const [detail, setDetail] = useState<DocumentRecord | null>(null);

	if (!workspaceId || !catalogId) {
		return (
			<ErrorState
				title="Invalid URL"
				message="Missing workspace or catalog id."
			/>
		);
	}

	if (ws.isLoading || catalogs.isLoading) {
		return <LoadingState label="Loading catalog…" />;
	}
	if (ws.isError) {
		return (
			<ErrorState title="Couldn't load workspace" message={ws.error.message} />
		);
	}
	if (catalogs.isError) {
		return (
			<ErrorState
				title="Couldn't load catalogs"
				message={catalogs.error.message}
			/>
		);
	}
	if (!catalog) {
		return (
			<div className="mx-auto max-w-3xl px-6 py-10">
				<ErrorState
					title="Catalog not found"
					message={`No catalog ${catalogId} in this workspace.`}
					actions={
						<Button variant="secondary" asChild>
							<Link to={`/workspaces/${workspaceId}`}>
								<ArrowLeft className="h-4 w-4" /> Back to workspace
							</Link>
						</Button>
					}
				/>
			</div>
		);
	}

	const canIngest = catalog.vectorStore !== null;

	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
			<header className="flex flex-col gap-2">
				<Link
					to={`/workspaces/${workspaceId}`}
					className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 w-max"
				>
					<ArrowLeft className="h-4 w-4" />
					{ws.data?.name ?? "Workspace"}
				</Link>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex items-start gap-3">
						<FolderOpen className="h-7 w-7 text-slate-400 mt-1" aria-hidden />
						<div>
							<h1 className="text-2xl font-semibold text-slate-900">
								{catalog.name}
							</h1>
							{catalog.description ? (
								<p className="text-sm text-slate-600">{catalog.description}</p>
							) : (
								<p className="text-xs text-slate-500 font-mono">
									{catalog.uid}
								</p>
							)}
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => docs.refetch()}
						>
							<RefreshCw className="h-4 w-4" /> Refresh
						</Button>
						<Button
							variant="brand"
							size="sm"
							onClick={() => setIngestOpen(true)}
							disabled={!canIngest}
							title={
								canIngest
									? "Ingest one or more files into this catalog"
									: "Bind this catalog to a vector store first"
							}
						>
							<Upload className="h-4 w-4" /> Ingest
						</Button>
					</div>
				</div>
			</header>

			<Card>
				<CardHeader>
					<CardTitle>Documents</CardTitle>
					<CardDescription>
						Each row is one uploaded file. Click a row to see the chunks the
						runtime extracted, plus full metadata and any error message if the
						ingest failed.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{docs.isLoading ? (
						<LoadingState label="Loading documents…" />
					) : docs.isError ? (
						<ErrorState
							title="Couldn't load documents"
							message={docs.error.message}
							actions={
								<Button variant="secondary" onClick={() => docs.refetch()}>
									<RefreshCw className="h-4 w-4" /> Retry
								</Button>
							}
						/>
					) : (
						<DocumentTable
							docs={docs.data ?? []}
							onSelect={(d) => setDetail(d)}
						/>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Saved queries</CardTitle>
					<CardDescription>
						Reusable text searches scoped to this catalog. Run them from here or
						from the playground.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<SavedQueriesSection
						workspace={workspaceId}
						catalogId={catalog.uid}
					/>
				</CardContent>
			</Card>

			<IngestQueueDialog
				workspace={workspaceId}
				catalog={catalog}
				open={ingestOpen}
				onOpenChange={setIngestOpen}
			/>
			<DocumentDetailDialog
				workspace={workspaceId}
				catalogId={catalog.uid}
				doc={detail}
				onOpenChange={(o) => !o && setDetail(null)}
			/>
		</div>
	);
}
