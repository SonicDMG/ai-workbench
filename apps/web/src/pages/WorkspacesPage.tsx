import { Boxes, Plus, RefreshCw } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { WorkspaceCard } from "@/components/workspaces/WorkspaceCard";
import { useWorkspaces } from "@/hooks/useWorkspaces";

export function WorkspacesPage() {
	const { data, isLoading, isError, error, refetch, isFetching } =
		useWorkspaces();

	if (isLoading) return <LoadingState label="Loading workspaces…" />;

	if (isError) {
		return (
			<ErrorState
				title="Couldn't load workspaces"
				message={error.message}
				actions={
					<Button variant="secondary" onClick={() => refetch()}>
						<RefreshCw className="h-4 w-4" />
						Retry
					</Button>
				}
			/>
		);
	}

	const workspaces = data ?? [];

	// First-run → onboarding.
	if (workspaces.length === 0) return <Navigate to="/onboarding" replace />;

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight text-slate-900">
						Workspaces
					</h1>
					<p className="mt-1 text-sm text-slate-500">
						{workspaces.length}{" "}
						{workspaces.length === 1 ? "workspace" : "workspaces"} · sorted by
						creation time
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="icon"
						onClick={() => refetch()}
						disabled={isFetching}
						aria-label="Refresh workspaces"
					>
						<RefreshCw
							className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
						/>
					</Button>
					<Button variant="brand" asChild>
						<Link to="/onboarding">
							<Plus className="h-4 w-4" />
							New workspace
						</Link>
					</Button>
				</div>
			</div>

			{workspaces.length === 0 ? (
				<EmptyState
					icon={<Boxes className="h-12 w-12" />}
					title="No workspaces yet"
					description="Workspaces isolate your catalogs, vector stores, and documents — one per tenant, environment, or customer."
					actions={
						<Button variant="brand" asChild>
							<Link to="/onboarding">
								<Plus className="h-4 w-4" />
								Create a workspace
							</Link>
						</Button>
					}
				/>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{workspaces.map((ws) => (
						<WorkspaceCard key={ws.uid} workspace={ws} />
					))}
				</div>
			)}
		</div>
	);
}
