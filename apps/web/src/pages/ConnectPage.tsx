import {
	Activity,
	AlertTriangle,
	ArrowLeft,
	BookOpen,
	CheckCircle2,
	Database,
	ExternalLink,
	KeyRound,
	Loader2,
	Plug,
	Terminal,
	XCircle,
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
import { useConnectTraffic } from "@/hooks/useConnectTraffic";
import { useConnectVerify } from "@/hooks/useConnectVerify";
import { useKnowledgeBases } from "@/hooks/useKnowledgeBases";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { ApiError, formatApiError } from "@/lib/api";
import type {
	ConnectSnippet,
	ConnectSnippetLanguage,
	ConnectTrafficEntry,
	ConnectVerifyResponse,
} from "@/lib/schemas";
import {
	HighlightedCode,
	type SupportedLanguage,
} from "@/lib/syntax-highlight";

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
						Copy-pasteable recipes for IBM watsonx Agent Builder, LangGraph,
						CrewAI, Google ADK, and Microsoft Agent Framework — powered by this
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
					<EndpointsCard data={snippets.data} workspaceId={workspaceId} />
					<FrameworkTabs
						active={activeTab}
						onChange={setActiveTab}
						snippets={snippets.data.targets}
					/>
					<TrafficStrip
						workspaceId={workspaceId}
						mcpEnabled={snippets.data.mcpEnabled}
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
	workspaceId,
}: {
	data: import("@/lib/schemas").ConnectSnippetsResponse;
	workspaceId: string;
}) {
	const verify = useConnectVerify(workspaceId);
	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between gap-3 pb-3">
				<div className="flex items-center gap-3">
					<KeyRound className="h-4 w-4 text-slate-500" />
					<CardTitle>Endpoints</CardTitle>
				</div>
				<VerifyButton
					mcpEnabled={data.mcpEnabled}
					running={verify.isPending}
					result={verify.data}
					transportError={verify.error}
					onClick={() => verify.mutate()}
				/>
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
				{verify.data ? <VerifyOutcome result={verify.data} /> : null}
			</CardContent>
		</Card>
	);
}

/**
 * The **Test** button in the Endpoints header. One click runs a
 * server-side `tools/list` smoke test against the workspace's MCP
 * server. We surface the outcome inline in the card so the user can
 * confirm the wire works before pasting a snippet anywhere.
 *
 * Renders three states past idle:
 *   - running  spinner
 *   - ok       green check + tool count
 *   - failed   red X
 *
 * Failure detail (mcp-off / verify_failed / transport error) lives in
 * the {@link VerifyOutcome} block below the endpoint rows — the
 * button itself stays compact so the header doesn't wrap on narrow
 * viewports.
 */
function VerifyButton({
	mcpEnabled,
	running,
	result,
	transportError,
	onClick,
}: {
	mcpEnabled: boolean;
	running: boolean;
	result: ConnectVerifyResponse | undefined;
	transportError: unknown;
	onClick: () => void;
}) {
	const status = verifyStatus({ running, result, transportError });
	return (
		<Button
			variant="secondary"
			size="sm"
			onClick={onClick}
			disabled={running || !mcpEnabled}
			title={
				mcpEnabled
					? "Run an internal tools/list smoke test"
					: "Enable MCP in workbench.yaml to run this check"
			}
		>
			{status === "running" ? (
				<Loader2 className="h-4 w-4 animate-spin" />
			) : status === "ok" ? (
				<CheckCircle2 className="h-4 w-4 text-emerald-600" />
			) : status === "failed" ? (
				<XCircle className="h-4 w-4 text-red-600" />
			) : null}
			{verifyButtonLabel({ running, result, transportError })}
		</Button>
	);
}

/**
 * Label text for the Verify button across all four states. Pulled
 * out so the failure case has a real label ("Failed — retry") rather
 * than reverting silently to "Test", which used to read as if the
 * button hadn't been clicked yet.
 */
function verifyButtonLabel(args: {
	running: boolean;
	result: ConnectVerifyResponse | undefined;
	transportError: unknown;
}): string {
	if (args.running) return "Testing…";
	if (args.transportError) return "Failed — retry";
	if (!args.result) return "Test";
	if (args.result.ok) {
		return `Reachable · ${args.result.toolCount} tool${args.result.toolCount === 1 ? "" : "s"}`;
	}
	if (!args.result.mcpEnabled) return "MCP disabled";
	return "Failed — retry";
}

type VerifyStatus = "idle" | "running" | "ok" | "failed";

function verifyStatus(args: {
	running: boolean;
	result: ConnectVerifyResponse | undefined;
	transportError: unknown;
}): VerifyStatus {
	if (args.running) return "running";
	if (args.transportError) return "failed";
	if (!args.result) return "idle";
	return args.result.ok ? "ok" : "failed";
}

/**
 * Detail block under the endpoint rows. Renders only when a verify
 * call has completed; teases out the three meaningful outcomes:
 *
 *   - ok        — green; lists the tools and the round-trip time
 *   - mcp off   — amber; nudges the operator toward `workbench.yaml`
 *   - failed    — red;   shows the `error.message` verbatim
 */
function VerifyOutcome({ result }: { result: ConnectVerifyResponse }) {
	if (result.ok) {
		return (
			<div className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
				<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
				<div className="min-w-0">
					<p className="font-medium">
						MCP endpoint is reachable — {result.toolCount} tool
						{result.toolCount === 1 ? "" : "s"} registered
						<span className="ml-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">
							({result.latencyMs}ms)
						</span>
					</p>
					<ul className="mt-1.5 flex flex-wrap gap-1">
						{result.tools.map((name) => (
							<li
								key={name}
								className="inline-flex items-center rounded-md bg-emerald-100 px-1.5 py-0.5 font-mono text-[11px] text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200"
							>
								{name}
							</li>
						))}
					</ul>
				</div>
			</div>
		);
	}
	if (!result.mcpEnabled) {
		// The amber "MCP is currently disabled" banner above this row
		// already explains the state — keep this row terse.
		return (
			<div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
				<AlertTriangle className="h-4 w-4 shrink-0" />
				<span>Test skipped — MCP is disabled on this runtime.</span>
			</div>
		);
	}
	return (
		<div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200">
			<XCircle className="mt-0.5 h-4 w-4 shrink-0" />
			<div>
				<p className="font-medium">MCP endpoint test failed.</p>
				<p className="mt-0.5 font-mono text-xs text-red-800 dark:text-red-300">
					{result.error?.message ?? "unknown error"}
				</p>
			</div>
		</div>
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

/**
 * `ConnectSnippetLanguage` and `SupportedLanguage` happen to share
 * the same string union today, but they live in different schemas
 * (one is the server response, one is the highlighter's input). A
 * tiny mapping function keeps the call site explicit and gives us a
 * safe fallback to `"text"` if a future server adds a language the
 * highlighter doesn't know about yet.
 */
function mapSnippetLanguage(lang: ConnectSnippetLanguage): SupportedLanguage {
	switch (lang) {
		case "python":
		case "typescript":
		case "bash":
		case "text":
			return lang;
		default: {
			// Exhaustiveness check — TS will flag this if a new union
			// member is added to ConnectSnippetLanguage without a case
			// here. Falling back to "text" is the safe runtime move.
			const _exhaustive: never = lang;
			void _exhaustive;
			return "text";
		}
	}
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
				{/*
				 * Do NOT add the `hljs` class to the <pre>. The theme
				 * rule in `index.css` is `.hljs { background: transparent
				 * }`, so putting it on the <pre> voids the
				 * `bg-slate-{900,950}` we set below — the dark code block
				 * then renders transparently against the page, which on
				 * a light-mode page reads as washed-out pastel text on
				 * white. The `hljs` class belongs only on the inner
				 * <code>, which `HighlightedCode` already adds for us.
				 *
				 * Light-mode background is `slate-900` to match the
				 * Astra Code modal next door — slightly lighter than the
				 * dark-mode `slate-950`, which keeps the block from
				 * looking like a pure-black tile punched out of a white
				 * card.
				 */}
				<pre className="max-h-[480px] overflow-auto rounded-md border border-slate-200 bg-slate-900 px-4 py-3 font-mono text-xs leading-relaxed text-slate-100 dark:border-slate-700 dark:bg-slate-950">
					<HighlightedCode
						code={snippet.code}
						language={mapSnippetLanguage(snippet.language)}
					/>
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

/* ----------------------- Traffic strip ----------------------- */

/**
 * The "Recent integration traffic" strip — a live feed of MCP tool
 * invocations for this workspace. Polls every 5s; backed by the
 * in-memory ring buffer the runtime keeps on the audit stream.
 *
 * The strip is the demo's living proof that the wire is up. When the
 * user pastes a snippet into a notebook and runs it, this list
 * lights up in seconds — no scrolling logs, no separate dashboard.
 *
 * Two states are interesting:
 *
 *   - **empty** — show an instructional placeholder pointing the
 *     user at the snippets above ("Run one of the recipes above to
 *     see calls land here").
 *   - **populated** — show the newest ~10 entries with relative
 *     timestamps, tool name, outcome icon, and (if known) the
 *     subject label.
 *
 * Errors from the poll are surfaced as a small inline warning rather
 * than a card-replacing error state — the strip is a "nice to have"
 * surface, and a transient failure shouldn't blank out the live feed
 * once it's been populated.
 */
function TrafficStrip({
	workspaceId,
	mcpEnabled,
}: {
	workspaceId: string;
	mcpEnabled: boolean;
}) {
	const traffic = useConnectTraffic(workspaceId, { enabled: mcpEnabled });

	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between gap-3 pb-3">
				<div className="flex items-center gap-3">
					<Activity className="h-4 w-4 text-slate-500" />
					<CardTitle>Recent integration traffic</CardTitle>
				</div>
				<TrafficSummary
					data={traffic.data}
					mcpEnabled={mcpEnabled}
					isLoading={traffic.isLoading}
				/>
			</CardHeader>
			<CardContent>
				{!mcpEnabled ? (
					<div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
						<AlertTriangle className="h-4 w-4" />
						<span>Disabled while MCP is off.</span>
					</div>
				) : traffic.isLoading && !traffic.data ? (
					<div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span>Loading…</span>
					</div>
				) : !traffic.data || traffic.data.entries.length === 0 ? (
					<TrafficEmpty />
				) : (
					<TrafficList entries={traffic.data.entries.slice(0, 10)} />
				)}
			</CardContent>
		</Card>
	);
}

function TrafficSummary({
	data,
	mcpEnabled,
	isLoading,
}: {
	data: import("@/lib/schemas").ConnectTrafficResponse | undefined;
	mcpEnabled: boolean;
	isLoading: boolean;
}) {
	if (!mcpEnabled) return null;
	if (!data) {
		return isLoading ? (
			<span className="text-xs text-slate-500 dark:text-slate-400">
				Polling…
			</span>
		) : null;
	}
	const { total, successes, failures } = data.summary;
	if (total === 0) {
		return (
			<span className="text-xs text-slate-500 dark:text-slate-400">
				No traffic yet · polling every 5s
			</span>
		);
	}
	return (
		<span className="text-xs text-slate-600 dark:text-slate-300">
			<span className="font-medium text-slate-900 dark:text-slate-100">
				{total}
			</span>{" "}
			call{total === 1 ? "" : "s"} ·{" "}
			<span className="text-emerald-700 dark:text-emerald-300">
				{successes} ok
			</span>
			{failures > 0 ? (
				<>
					{" "}
					·{" "}
					<span className="text-red-700 dark:text-red-300">
						{failures} failed
					</span>
				</>
			) : null}
			<span className="ml-2 text-slate-400 dark:text-slate-500">
				(last 24h)
			</span>
		</span>
	);
}

function TrafficEmpty() {
	return (
		<div className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
			<p>No traffic yet.</p>
			<p className="mt-1 text-xs">
				Paste one of the recipes above into your agent and run it — calls will
				appear here within a few seconds.
			</p>
		</div>
	);
}

function TrafficList({ entries }: { entries: readonly ConnectTrafficEntry[] }) {
	return (
		<ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
			{entries.map((entry) => (
				<li
					key={`${entry.at}-${entry.toolName}`}
					className="flex items-center gap-3 py-2"
				>
					<OutcomeDot outcome={entry.outcome} />
					<code className="font-mono text-xs text-slate-800 dark:text-slate-100">
						{entry.toolName}
					</code>
					<span className="text-xs text-slate-500 dark:text-slate-400">
						{relativeTime(entry.at)}
					</span>
					{entry.subjectLabel ? (
						<span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
							{entry.subjectLabel}
						</span>
					) : entry.subjectType === "anonymous" ? (
						<span className="ml-auto text-xs italic text-slate-400 dark:text-slate-500">
							anonymous
						</span>
					) : null}
				</li>
			))}
		</ul>
	);
}

function OutcomeDot({ outcome }: { outcome: ConnectTrafficEntry["outcome"] }) {
	const color =
		outcome === "success"
			? "bg-emerald-500"
			: outcome === "denied"
				? "bg-amber-500"
				: "bg-red-500";
	return (
		<span
			role="img"
			aria-label={outcome}
			className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`}
		/>
	);
}

/**
 * Cheap relative time formatter. Pure function so we don't pull a
 * larger date lib in just for "12s ago". Resolution is 1s up to a
 * minute, 1m up to an hour, then 1h up to a day, then date.
 */
function relativeTime(isoTimestamp: string): string {
	const then = Date.parse(isoTimestamp);
	if (Number.isNaN(then)) return isoTimestamp;
	const now = Date.now();
	const seconds = Math.max(0, Math.floor((now - then) / 1000));
	if (seconds < 5) return "just now";
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
