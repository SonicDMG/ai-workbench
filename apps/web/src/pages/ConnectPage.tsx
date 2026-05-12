import {
	AlertTriangle,
	ArrowLeft,
	BookOpen,
	Database,
	ExternalLink,
	KeyRound,
	Plug,
	Terminal,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { CopyButton } from "@/components/common/CopyButton";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useConnectSnippets } from "@/hooks/useConnectSnippets";
import { useKnowledgeBases } from "@/hooks/useKnowledgeBases";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { ApiError, formatApiError } from "@/lib/api";
import type { ConnectSnippet } from "@/lib/schemas";

const ALL_KBS_SENTINEL = "__all__";

/**
 * Workspace **Connect** page — the headline "show people the wire is
 * already there" surface. Renders the per-framework recipe set from
 * `GET /api/v1/workspaces/{w}/connect/snippets` plus the resolved
 * endpoint URLs.
 *
 * The whole page is read-only; switching the KB scope or the env-var
 * name re-renders entirely from the cached query, no server round-trip
 * needed once the snippets are in-memory (react-query default
 * staleness window plus the server's short Cache-Control). That makes
 * scrubbing through the framework tabs in a demo feel instant.
 */
export function ConnectPage() {
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const [scopedKbId, setScopedKbId] = useState<string>(ALL_KBS_SENTINEL);
	const [activeTab, setActiveTab] = useState<string>("langgraph");

	const ws = useWorkspace(workspaceId);
	const kbs = useKnowledgeBases(workspaceId);
	const snippets = useConnectSnippets(workspaceId, {
		knowledgeBaseId: scopedKbId === ALL_KBS_SENTINEL ? null : scopedKbId,
	});

	if (!workspaceId) return <Navigate to="/" replace />;

	if (ws.isLoading) return <LoadingState label="Loading workspace…" />;
	if (ws.isError || !ws.data) {
		const message =
			ws.error instanceof ApiError && ws.error.code === "workspace_not_found"
				? "This workspace doesn't exist or was deleted."
				: formatApiError(ws.error);
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
				<Link to={`/workspaces/${workspaceId}`}>
					<ArrowLeft className="h-4 w-4" />
					Back to workspace
				</Link>
			</Button>

			<header className="flex flex-wrap items-end justify-between gap-4">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
						<Plug className="h-3.5 w-3.5" />
						<span>Connect</span>
					</div>
					<h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
						Plug {ws.data.name} into your agent stack
					</h1>
					<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
						Copy-pasteable recipes for LangGraph, CrewAI, Google ADK, Microsoft
						Agent Framework, and IBM watsonx Agent Builder — powered by this
						workspace's MCP endpoint.
					</p>
				</div>
				<ScopePicker
					value={scopedKbId}
					onChange={setScopedKbId}
					options={(kbs.data ?? []).map((kb) => ({
						id: kb.knowledgeBaseId,
						name: kb.name,
					}))}
					loading={kbs.isLoading}
				/>
			</header>

			{snippets.isLoading ? (
				<LoadingState label="Rendering recipes…" />
			) : snippets.isError || !snippets.data ? (
				<ErrorState
					title="Couldn't render the recipes"
					message={formatApiError(snippets.error)}
				/>
			) : (
				<>
					<EndpointsCard data={snippets.data} />
					<FrameworkTabs
						active={activeTab}
						onChange={setActiveTab}
						snippets={snippets.data.targets}
					/>
				</>
			)}
		</div>
	);
}

/* ----------------------- Scope picker ----------------------- */

interface ScopePickerOption {
	readonly id: string;
	readonly name: string;
}

function ScopePicker({
	value,
	onChange,
	options,
	loading,
}: {
	value: string;
	onChange: (v: string) => void;
	options: readonly ScopePickerOption[];
	loading: boolean;
}) {
	return (
		<div className="flex items-center gap-2 text-sm">
			<Database className="h-4 w-4 text-slate-500" />
			<span className="text-slate-600 dark:text-slate-300">Scope:</span>
			<Select value={value} onValueChange={onChange} disabled={loading}>
				<SelectTrigger className="h-9 min-w-[14rem]">
					<SelectValue placeholder="All knowledge bases" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={ALL_KBS_SENTINEL}>All knowledge bases</SelectItem>
					{options.map((opt) => (
						<SelectItem key={opt.id} value={opt.id}>
							{opt.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

/* ----------------------- Endpoints card ----------------------- */

function EndpointsCard({
	data,
}: {
	data: import("@/lib/schemas").ConnectSnippetsResponse;
}) {
	return (
		<Card>
			<CardHeader className="flex-row items-center gap-3 pb-3">
				<KeyRound className="h-4 w-4 text-slate-500" />
				<CardTitle>Endpoints</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<EndpointRow
					label="MCP (Streamable HTTP)"
					value={data.mcpUrl}
					muted={!data.mcpEnabled}
				/>
				<EndpointRow label="REST base" value={data.restBaseUrl} />
				<EndpointRow
					label="API-key env var"
					value={data.apiKeyEnvVar}
					hint="Snippets read the key from this env var — never hard-coded."
				/>
				{!data.mcpEnabled ? (
					<div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
						<div>
							<p className="font-medium">MCP is currently disabled.</p>
							<p className="mt-0.5 text-amber-800 dark:text-amber-300">
								The MCP-based recipes below will 404 against this runtime until
								an operator sets <code>mcp.enabled: true</code> in{" "}
								<code>workbench.yaml</code>. The watsonx → Option B
								(REST-via-OpenAPI) path works either way.
							</p>
						</div>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

function EndpointRow({
	label,
	value,
	hint,
	muted = false,
}: {
	label: string;
	value: string;
	hint?: string;
	muted?: boolean;
}) {
	return (
		<div>
			<div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
				{label}
			</div>
			<div className="mt-1 flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
				<code
					className={`min-w-0 flex-1 break-all font-mono text-xs ${muted ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"}`}
				>
					{value}
				</code>
				<CopyButton
					value={value}
					label={`Copy ${label}`}
					className="shrink-0"
				/>
			</div>
			{hint ? (
				<p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
					{hint}
				</p>
			) : null}
		</div>
	);
}

/* ----------------------- Framework tabs ----------------------- */

function FrameworkTabs({
	active,
	onChange,
	snippets,
}: {
	active: string;
	onChange: (id: string) => void;
	snippets: readonly ConnectSnippet[];
}) {
	const activeSnippet = useMemo(
		() => snippets.find((s) => s.id === active) ?? snippets[0],
		[snippets, active],
	);
	if (!activeSnippet) return null;
	return (
		<Card>
			<CardHeader className="pb-0">
				<div className="-mx-1 flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-700">
					{snippets.map((snippet) => {
						const selected = snippet.id === activeSnippet.id;
						return (
							<button
								key={snippet.id}
								type="button"
								onClick={() => onChange(snippet.id)}
								aria-pressed={selected}
								className={`-mb-px rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
									selected
										? "border border-slate-200 border-b-transparent bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
										: "border border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
								}`}
							>
								{snippet.displayName}
							</button>
						);
					})}
				</div>
			</CardHeader>
			<CardContent className="pt-5">
				<SnippetView snippet={activeSnippet} />
			</CardContent>
		</Card>
	);
}

function SnippetView({ snippet }: { snippet: ConnectSnippet }) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-sm text-slate-700 dark:text-slate-200">
						{snippet.tagline}
					</p>
					{snippet.install ? (
						<p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
							<span className="mr-1 inline-flex items-center gap-1 align-middle">
								<Terminal className="h-3.5 w-3.5" />
							</span>
							<code className="font-mono">{snippet.install}</code>
						</p>
					) : null}
				</div>
				<Button variant="ghost" size="sm" asChild>
					<a href={snippet.docsUrl} target="_blank" rel="noreferrer">
						<BookOpen className="h-4 w-4" />
						Framework docs
						<ExternalLink className="h-3 w-3 opacity-70" />
					</a>
				</Button>
			</div>

			<div className="relative">
				<pre className="max-h-[480px] overflow-auto rounded-md border bg-slate-950 px-4 py-3 font-mono text-xs leading-relaxed text-slate-100 dark:border-slate-700">
					<code>{snippet.code}</code>
				</pre>
				<CopyButton
					value={snippet.code}
					label="Copy code"
					className="absolute right-2 top-2 bg-slate-900/80 text-slate-100 hover:bg-slate-800"
				/>
			</div>

			{snippet.notes ? (
				<div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
					{snippet.notes}
				</div>
			) : null}
		</div>
	);
}
