import {
	AlertTriangle,
	ArrowLeft,
	Check,
	Clock,
	Code2,
	Copy,
	Play,
	Sparkles,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { KindBadge } from "@/components/workspaces/KindBadge";
import { useKnowledgeBases } from "@/hooks/useKnowledgeBases";
import { usePlaygroundCommand } from "@/hooks/usePlayground";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { formatApiError } from "@/lib/api";
import { CODE_LANGUAGES, type CodeLanguage } from "@/lib/astra-codegen";
import { generatePlaygroundCode } from "@/lib/playground-codegen";
import {
	defaultPlaygroundCommand,
	firstPlaygroundCommandId,
	getPlaygroundCommandDef,
	PLAYGROUND_COMMANDS_BY_TARGET,
	type PlaygroundCommandDef,
	type PlaygroundTargetKind,
} from "@/lib/playground-command-catalog";
import type {
	KnowledgeBaseRecord,
	PlaygroundCommandResponse,
	Workspace,
} from "@/lib/schemas";
import {
	HighlightedCode,
	type SupportedLanguage,
} from "@/lib/syntax-highlight";
import { cn } from "@/lib/utils";

const HIGHLIGHT_LANGUAGE: Readonly<Record<CodeLanguage, SupportedLanguage>> = {
	typescript: "typescript",
	python: "python",
	java: "java",
	curl: "bash",
};

/**
 * Workspace-scoped playground for Astra Data API commands.
 *
 * Unlike the old KB search scratchpad, this page works at the workspace
 * level and sends curated Data API command envelopes through the
 * runtime's TypeScript client.
 */
export function PlaygroundPage() {
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const workspace = useWorkspace(workspaceId);
	const knowledgeBases = useKnowledgeBases(workspaceId);

	if (!workspaceId) return <Navigate to="/" replace />;
	if (workspace.isLoading)
		return <LoadingState label="Loading playground..." />;
	if (workspace.isError || !workspace.data) {
		return (
			<ErrorState
				title="Couldn't load workspace"
				message={formatApiError(workspace.error)}
				actions={
					<Button variant="secondary" asChild>
						<Link to="/">Back to workspaces</Link>
					</Button>
				}
			/>
		);
	}

	const disabled = workspace.data.kind !== "astra";

	return (
		<div className="flex flex-col gap-6">
			<Button variant="ghost" size="sm" asChild className="-ml-3 self-start">
				<Link to={`/workspaces/${workspace.data.workspaceId}`}>
					<ArrowLeft className="h-4 w-4" />
					Back to workspace
				</Link>
			</Button>

			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-3">
						<span className="brand-tile" aria-hidden="true">
							<Sparkles className="h-5 w-5" />
						</span>
						<h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
							Data API Playground
						</h1>
						<KindBadge kind={workspace.data.kind} />
					</div>
					<p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
						Run Astra Data API commands against {workspace.data.name} and copy
						the matching client code.
					</p>
				</div>
				<div className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-400">
					<span className="font-medium text-slate-900 dark:text-slate-100">
						Keyspace
					</span>{" "}
					<code>{workspace.data.keyspace ?? "default"}</code>
				</div>
			</div>

			{disabled ? (
				<Card>
					<CardContent className="flex items-start gap-3 p-6">
						<AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
						<div>
							<p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
								Playground is available for Astra workspaces.
							</p>
							<p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
								This workspace is {workspace.data.kind}. Switch to an Astra
								workspace to execute Data API commands.
							</p>
						</div>
					</CardContent>
				</Card>
			) : (
				<PlaygroundWorkbench
					workspace={workspace.data}
					knowledgeBases={knowledgeBases.data ?? []}
					collectionsLoading={knowledgeBases.isLoading}
				/>
			)}
		</div>
	);
}

function PlaygroundWorkbench({
	workspace,
	knowledgeBases,
	collectionsLoading,
}: {
	workspace: Workspace;
	knowledgeBases: readonly KnowledgeBaseRecord[];
	collectionsLoading: boolean;
}) {
	const collectionOptions = useMemo(
		() =>
			Array.from(
				new Set(
					knowledgeBases
						.map((kb) => kb.vectorCollection ?? kb.name)
						.filter((name) => name.length > 0),
				),
			),
		[knowledgeBases],
	);
	const firstCollection = collectionOptions[0] ?? "";
	const [targetKind, setTargetKind] =
		useState<PlaygroundTargetKind>("collection");
	const [selectedId, setSelectedId] = useState(() =>
		firstPlaygroundCommandId("collection"),
	);
	const selected = getPlaygroundCommandDef(targetKind, selectedId);
	const [collection, setCollection] = useState(firstCollection);
	const [table, setTable] = useState("demo_table");
	const [commandText, setCommandText] = useState(() =>
		formatJson(defaultPlaygroundCommand(selectedId, firstCollection)),
	);
	const [parseError, setParseError] = useState<string | null>(null);
	const [result, setResult] = useState<PlaygroundCommandResult | null>(null);
	const execute = usePlaygroundCommand();

	useEffect(() => {
		if (collection || !firstCollection) return;
		setCollection(firstCollection);
		if (targetKind === "collection") {
			setCommandText(
				formatJson(defaultPlaygroundCommand(selectedId, firstCollection)),
			);
		}
	}, [collection, firstCollection, selectedId, targetKind]);

	function chooseTargetKind(next: PlaygroundTargetKind) {
		if (next === targetKind) return;
		const nextId = firstPlaygroundCommandId(next);
		setTargetKind(next);
		setSelectedId(nextId);
		setParseError(null);
		setResult(null);
		setCommandText(
			formatJson(defaultPlaygroundCommand(nextId, targetName(next))),
		);
	}

	function chooseCommand(next: PlaygroundCommandDef) {
		setSelectedId(next.id);
		setParseError(null);
		setResult(null);
		setCommandText(formatJson(defaultPlaygroundCommand(next.id, targetName())));
	}

	function resetCommand() {
		setParseError(null);
		setCommandText(
			formatJson(defaultPlaygroundCommand(selectedId, targetName())),
		);
	}

	function targetName(kind = targetKind) {
		return kind === "table" ? table : collection || firstCollection;
	}

	async function runCommand() {
		const parsed = parseJsonObject(commandText);
		if (!parsed.ok) {
			setParseError(parsed.message);
			return;
		}
		const target = targetName().trim();
		if (selected.requiresTarget && target.length === 0) {
			setParseError(`${targetLabel(targetKind)} is required for this command.`);
			return;
		}

		setParseError(null);
		try {
			const response = await execute.mutateAsync({
				workspace: workspace.workspaceId,
				input: {
					commandName: selected.name,
					targetKind,
					collection:
						selected.requiresTarget && targetKind === "collection"
							? target
							: null,
					table:
						selected.requiresTarget && targetKind === "table" ? target : null,
					command: parsed.value,
				},
			});
			setResult({ kind: "success", response });
			toast.success("Command executed", {
				description: `${selected.label} finished in ${response.elapsedMs} ms`,
			});
		} catch (err) {
			const message = formatApiError(err);
			setResult({ kind: "error", message });
			toast.error("Command failed", { description: message });
		}
	}

	const parsedForCode = parseJsonObject(commandText);
	const commandForCode = parsedForCode.ok ? parsedForCode.value : null;

	return (
		<div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
			<Card className="h-max">
				<CardHeader className="space-y-3">
					<CardTitle className="text-base">Commands</CardTitle>
					<fieldset className="grid grid-cols-2 rounded-md bg-slate-100 p-1 text-xs font-medium dark:bg-slate-800">
						<legend className="sr-only">Command target</legend>
						{(["collection", "table"] as const).map((kind) => (
							<button
								key={kind}
								type="button"
								onClick={() => chooseTargetKind(kind)}
								className={cn(
									"rounded px-2 py-1.5 transition-colors",
									targetKind === kind
										? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100"
										: "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
								)}
								aria-pressed={targetKind === kind}
							>
								{targetLabel(kind)}
							</button>
						))}
					</fieldset>
				</CardHeader>
				<CardContent className="flex flex-col gap-1.5">
					{PLAYGROUND_COMMANDS_BY_TARGET[targetKind].map((cmd) => (
						<button
							key={cmd.id}
							type="button"
							onClick={() => chooseCommand(cmd)}
							className={cn(
								"rounded-md border px-3 py-2 text-left transition-colors",
								cmd.id === selected.id
									? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-900)]"
									: "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800",
							)}
						>
							<span className="flex items-center justify-between gap-2">
								<span className="text-sm font-medium">{cmd.label}</span>
								<span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium uppercase text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
									{cmd.category}
								</span>
							</span>
							<span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
								{cmd.description}
							</span>
						</button>
					))}
				</CardContent>
			</Card>

			<div className="flex min-w-0 flex-col gap-4">
				<Card>
					<CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
						<div>
							<CardTitle className="text-base">{selected.label}</CardTitle>
							<p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
								{selected.description}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<Button variant="ghost" size="sm" onClick={resetCommand}>
								Reset
							</Button>
							<Button
								variant="brand"
								size="sm"
								onClick={runCommand}
								disabled={execute.isPending}
							>
								<Play className="h-4 w-4" />
								{execute.isPending ? "Running" : "Run"}
							</Button>
						</div>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						{selected.requiresTarget ? (
							<div>
								<label
									htmlFor="playground-target"
									className="text-xs font-medium text-slate-600 dark:text-slate-400"
								>
									{targetLabel(targetKind)}
								</label>
								<Input
									id="playground-target"
									value={targetKind === "table" ? table : collection}
									onChange={(event) =>
										targetKind === "table"
											? setTable(event.target.value)
											: setCollection(event.target.value)
									}
									placeholder={
										targetKind === "collection" && collectionsLoading
											? "Loading collections..."
											: `${targetKind}_name`
									}
									list={
										targetKind === "collection"
											? "playground-collections"
											: undefined
									}
									className="mt-1 font-mono"
								/>
								<datalist id="playground-collections">
									{collectionOptions.map((name) => (
										<option key={name} value={name} />
									))}
								</datalist>
							</div>
						) : null}

						<div>
							<label
								htmlFor="playground-command"
								className="text-xs font-medium text-slate-600 dark:text-slate-400"
							>
								Command JSON
							</label>
							<Textarea
								id="playground-command"
								value={commandText}
								onChange={(event) => {
									setCommandText(event.target.value);
									setParseError(null);
								}}
								spellCheck={false}
								className="mt-1 h-[240px] max-h-[240px] min-h-[180px] resize-none overflow-auto font-mono text-xs leading-relaxed"
								aria-invalid={parseError ? true : undefined}
							/>
							{parseError ? (
								<p className="mt-2 text-xs text-red-600 dark:text-red-400">
									{parseError}
								</p>
							) : null}
						</div>
					</CardContent>
				</Card>

				<ResultPanel result={result} pending={execute.isPending} />

				<CodePanel
					workspace={workspace}
					command={commandForCode}
					targetKind={targetKind}
					targetName={selected.requiresTarget ? targetName().trim() : null}
				/>
			</div>
		</div>
	);
}

type PlaygroundCommandResult =
	| { readonly kind: "success"; readonly response: PlaygroundCommandResponse }
	| { readonly kind: "error"; readonly message: string };

function CodePanel({
	workspace,
	command,
	targetKind,
	targetName,
}: {
	workspace: Workspace;
	command: Record<string, unknown> | null;
	targetKind: PlaygroundTargetKind;
	targetName: string | null;
}) {
	const [language, setLanguage] = useState<CodeLanguage>("typescript");
	const [copied, setCopied] = useState(false);
	const code = command
		? generatePlaygroundCode(language, {
				workspace,
				command,
				targetKind,
				targetName,
			})
		: "Fix the command JSON to generate client code.";

	async function copyCode() {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			// Manual copy from the rendered block still works.
		}
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
				<CardTitle className="flex items-center gap-2 text-base">
					<Code2 className="h-4 w-4" />
					Client code
				</CardTitle>
				<Button variant="secondary" size="sm" onClick={copyCode}>
					{copied ? (
						<Check className="h-4 w-4" />
					) : (
						<Copy className="h-4 w-4" />
					)}
					{copied ? "Copied" : "Copy"}
				</Button>
			</CardHeader>
			<CardContent>
				<div className="flex flex-wrap gap-1.5 border-b border-slate-200 dark:border-slate-700">
					{CODE_LANGUAGES.map((opt) => (
						<button
							key={opt.id}
							type="button"
							onClick={() => setLanguage(opt.id)}
							className={cn(
								"rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
								opt.id === language
									? "border-[var(--color-brand-600)] text-[var(--color-brand-700)]"
									: "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
							)}
							aria-current={opt.id === language}
						>
							{opt.label}
						</button>
					))}
				</div>
				<pre className="mt-3 max-h-[420px] overflow-auto rounded-md border border-slate-200 bg-slate-900 p-4 text-xs leading-relaxed text-slate-100 dark:border-slate-800 dark:bg-slate-950">
					<HighlightedCode
						code={code}
						language={HIGHLIGHT_LANGUAGE[language]}
					/>
				</pre>
			</CardContent>
		</Card>
	);
}

function ResultPanel({
	result,
	pending,
}: {
	result: PlaygroundCommandResult | null;
	pending: boolean;
}) {
	if (pending) {
		return (
			<Card>
				<CardContent className="p-6">
					<LoadingState label="Executing command..." />
				</CardContent>
			</Card>
		);
	}

	if (!result) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Results</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-slate-500 dark:text-slate-400">
						Run a command to see the Data API response here.
					</p>
				</CardContent>
			</Card>
		);
	}

	if (result.kind === "error") {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Results</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
						{result.message}
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
				<CardTitle className="text-base">Results</CardTitle>
				<div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
					<Clock className="h-3.5 w-3.5" />
					{result.response.elapsedMs} ms
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
					<ResultMeta label="Command">{result.response.commandName}</ResultMeta>
					<ResultMeta label="Target">
						{result.response.targetName ??
							result.response.collection ??
							result.response.table ??
							"keyspace"}
					</ResultMeta>
					<ResultMeta label="Keyspace">
						{result.response.keyspace ?? "default"}
					</ResultMeta>
				</div>
				<pre className="max-h-[520px] overflow-auto rounded-md border border-slate-200 bg-slate-950 p-4 text-xs leading-relaxed text-slate-100 dark:border-slate-800">
					<code>{formatJson(result.response.result)}</code>
				</pre>
			</CardContent>
		</Card>
	);
}

function ResultMeta({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<span className="rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800">
			<span className="font-medium text-slate-700 dark:text-slate-300">
				{label}
			</span>{" "}
			<code>{children}</code>
		</span>
	);
}

function parseJsonObject(
	value: string,
):
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; message: string } {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return { ok: false, message: "Command JSON must be an object." };
		}
		return { ok: true, value: parsed as Record<string, unknown> };
	} catch (err) {
		return {
			ok: false,
			message: err instanceof Error ? err.message : "Invalid JSON.",
		};
	}
}

function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function targetLabel(kind: PlaygroundTargetKind): string {
	return kind === "table" ? "Table" : "Collection";
}
