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

interface CodeContext {
	readonly workspace: Workspace;
	readonly command: Record<string, unknown>;
	readonly targetKind: PlaygroundTargetKind;
	readonly targetName: string | null;
}

function generatePlaygroundCode(
	language: CodeLanguage,
	ctx: CodeContext,
): string {
	switch (language) {
		case "typescript":
			return generateTypeScript(ctx);
		case "python":
			return generatePython(ctx);
		case "java":
			return generateJava(ctx);
		case "curl":
			return generateCurl(ctx);
	}
}

interface ExtractedCommand {
	readonly op: string;
	readonly body: Record<string, unknown>;
}

function extractCommand(
	command: Record<string, unknown>,
): ExtractedCommand | null {
	const keys = Object.keys(command);
	if (keys.length !== 1) return null;
	const op = keys[0];
	if (!op) return null;
	const body = command[op];
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return null;
	}
	return { op, body: body as Record<string, unknown> };
}

function explainFlag(body: Record<string, unknown>): boolean {
	const options = body.options;
	if (options && typeof options === "object" && !Array.isArray(options)) {
		return (options as Record<string, unknown>).explain === true;
	}
	return false;
}

function indentLines(value: string, indent: string): string {
	return value
		.split("\n")
		.map((line) => (line.length > 0 ? `${indent}${line}` : line))
		.join("\n");
}

function generateTypeScript({
	workspace,
	command,
	targetKind,
	targetName,
}: CodeContext) {
	const endpoint = endpointForCode(workspace, "typescript");
	const keyspaceArg = workspace.keyspace
		? `, { keyspace: ${jsString(workspace.keyspace)} }`
		: "";
	const preamble = `import { DataAPIClient } from "@datastax/astra-db-ts";

const client = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN!);
const db = client.db(${endpoint}${keyspaceArg});
`;

	const snippet = idiomaticTypeScript(command, targetKind, targetName);
	if (snippet) {
		return `${preamble}\n${snippet}\n`;
	}

	const optionsArg = targetName
		? `, { ${targetKind}: ${jsString(targetName)} }`
		: "";
	return `${preamble}
const command = ${formatJson(command)} as const;
const result = await db.command(command${optionsArg});
console.log(result);
`;
}

function idiomaticTypeScript(
	command: Record<string, unknown>,
	targetKind: PlaygroundTargetKind,
	targetName: string | null,
): string | null {
	const extracted = extractCommand(command);
	if (!extracted) return null;
	const { op, body } = extracted;
	const name = typeof body.name === "string" ? body.name : "";

	switch (op) {
		case "findCollections": {
			return explainFlag(body)
				? `const collections = await db.listCollections();
console.log(collections);`
				: `const names = await db.listCollections({ nameOnly: true });
console.log(names);`;
		}
		case "createCollection": {
			const options = body.options;
			const optionsArg =
				options && typeof options === "object"
					? `, ${formatJson(options)}`
					: "";
			return `const collection = await db.createCollection(${jsString(name)}${optionsArg});
console.log(collection.name);`;
		}
		case "deleteCollection": {
			return `await db.dropCollection(${jsString(name)});
console.log("Dropped ${name}");`;
		}
		case "listTables": {
			return explainFlag(body)
				? `const tables = await db.listTables();
console.log(tables);`
				: `const names = await db.listTables({ nameOnly: true });
console.log(names);`;
		}
		case "createTable": {
			const definition = body.definition ?? {};
			return `const table = await db.createTable(${jsString(name)}, {
  definition: ${formatJson(definition)},
});
console.log(table.name);`;
		}
		case "dropTable": {
			return `await db.dropTable(${jsString(name)});
console.log("Dropped ${name}");`;
		}
		case "dropIndex": {
			return `await db.dropTableIndex(${jsString(name)});
console.log("Dropped index ${name}");`;
		}
	}

	if (!targetName) return null;
	const handle =
		targetKind === "table"
			? `const table = db.table(${jsString(targetName)});`
			: `const collection = db.collection(${jsString(targetName)});`;
	const receiver = targetKind === "table" ? "table" : "collection";

	switch (op) {
		case "find": {
			const filter = body.filter ?? {};
			const options = body.options;
			const optionsArg =
				options && typeof options === "object"
					? `, ${formatJson(options)}`
					: "";
			return `${handle}
const rows = await ${receiver}.find(${formatJson(filter)}${optionsArg}).toArray();
console.log(rows);`;
		}
		case "findOne": {
			const filter = body.filter ?? {};
			const options = body.options;
			const optionsArg =
				options && typeof options === "object"
					? `, ${formatJson(options)}`
					: "";
			return `${handle}
const row = await ${receiver}.findOne(${formatJson(filter)}${optionsArg});
console.log(row);`;
		}
		case "distinct": {
			const key = typeof body.key === "string" ? body.key : "";
			const filter = body.filter ?? {};
			return `${handle}
const values = await ${receiver}.distinct(${jsString(key)}, ${formatJson(filter)});
console.log(values);`;
		}
		case "countDocuments": {
			const filter = body.filter ?? {};
			const upper =
				typeof body.upperBound === "number" ? body.upperBound : 1000;
			return `${handle}
const total = await ${receiver}.countDocuments(${formatJson(filter)}, ${upper});
console.log(total);`;
		}
		case "insertOne": {
			const document = body.document ?? {};
			return `${handle}
const result = await ${receiver}.insertOne(${formatJson(document)});
console.log(result);`;
		}
		case "insertMany": {
			const documents = body.documents ?? [];
			return `${handle}
const result = await ${receiver}.insertMany(${formatJson(documents)});
console.log(result);`;
		}
		case "updateOne": {
			const filter = body.filter ?? {};
			const update = body.update ?? {};
			return `${handle}
const result = await ${receiver}.updateOne(${formatJson(filter)}, ${formatJson(update)});
console.log(result);`;
		}
		case "updateMany": {
			const filter = body.filter ?? {};
			const update = body.update ?? {};
			return `${handle}
const result = await ${receiver}.updateMany(${formatJson(filter)}, ${formatJson(update)});
console.log(result);`;
		}
		case "deleteOne": {
			const filter = body.filter ?? {};
			return `${handle}
const result = await ${receiver}.deleteOne(${formatJson(filter)});
console.log(result);`;
		}
		case "deleteMany": {
			const filter = body.filter ?? {};
			return `${handle}
const result = await ${receiver}.deleteMany(${formatJson(filter)});
console.log(result);`;
		}
		case "listIndexes": {
			return explainFlag(body)
				? `${handle}
const indexes = await ${receiver}.listIndexes();
console.log(indexes);`
				: `${handle}
const names = await ${receiver}.listIndexes({ nameOnly: true });
console.log(names);`;
		}
		case "createIndex": {
			const definition = body.definition;
			if (
				definition &&
				typeof definition === "object" &&
				!Array.isArray(definition) &&
				typeof (definition as Record<string, unknown>).column === "string"
			) {
				const column = (definition as Record<string, unknown>).column as string;
				return `${handle}
await ${receiver}.createIndex(${jsString(name)}, ${jsString(column)});`;
			}
			return `${handle}
await ${receiver}.createIndex(${jsString(name)}, ${formatJson(definition ?? {})});`;
		}
	}

	return null;
}

function generatePython({
	workspace,
	command,
	targetKind,
	targetName,
}: CodeContext) {
	const endpoint = endpointForCode(workspace, "python");
	const keyspaceArg = workspace.keyspace
		? `, keyspace=${pyString(workspace.keyspace)}`
		: "";
	const preamble = `import os
from astrapy import DataAPIClient

client = DataAPIClient(os.environ["ASTRA_DB_APPLICATION_TOKEN"])
database = client.get_database(${endpoint}${keyspaceArg})
`;

	const snippet = idiomaticPython(command, targetKind, targetName);
	if (snippet) {
		return `${preamble}\n${snippet}\n`;
	}

	const targetArg = targetName
		? `, ${targetKind}_name=${pyString(targetName)}`
		: "";
	return `import json
${preamble}
command = json.loads(r'''${formatJson(command)}''')
result = database.command(command${targetArg})
print(result)
`;
}

function idiomaticPython(
	command: Record<string, unknown>,
	targetKind: PlaygroundTargetKind,
	targetName: string | null,
): string | null {
	const extracted = extractCommand(command);
	if (!extracted) return null;
	const { op, body } = extracted;
	const name = typeof body.name === "string" ? body.name : "";

	switch (op) {
		case "findCollections": {
			return explainFlag(body)
				? `collections = database.list_collections()
print(collections)`
				: `names = database.list_collection_names()
print(names)`;
		}
		case "createCollection": {
			const options = body.options;
			if (options && typeof options === "object" && !Array.isArray(options)) {
				return `collection = database.create_collection(
    ${pyString(name)},
    definition=${pyDict(options)},
)
print(collection.name)`;
			}
			return `collection = database.create_collection(${pyString(name)})
print(collection.name)`;
		}
		case "deleteCollection": {
			return `database.drop_collection(${pyString(name)})
print(${pyString(`Dropped ${name}`)})`;
		}
		case "listTables": {
			return explainFlag(body)
				? `tables = database.list_tables()
print(tables)`
				: `names = database.list_table_names()
print(names)`;
		}
		case "createTable": {
			const definition = body.definition ?? {};
			return `table = database.create_table(
    ${pyString(name)},
    definition=${pyDict(definition)},
)
print(table.name)`;
		}
		case "dropTable": {
			return `database.drop_table(${pyString(name)})
print(${pyString(`Dropped ${name}`)})`;
		}
		case "dropIndex": {
			return `database.drop_table_index(${pyString(name)})
print(${pyString(`Dropped index ${name}`)})`;
		}
	}

	if (!targetName) return null;
	const handle =
		targetKind === "table"
			? `table = database.get_table(${pyString(targetName)})`
			: `collection = database.get_collection(${pyString(targetName)})`;
	const receiver = targetKind === "table" ? "table" : "collection";

	switch (op) {
		case "find": {
			const filter = body.filter ?? {};
			const options = body.options;
			const kwargs =
				options && typeof options === "object"
					? `, ${pyKwargsFromOptions(options as Record<string, unknown>)}`
					: "";
			return `${handle}
rows = list(${receiver}.find(${pyDict(filter)}${kwargs}))
print(rows)`;
		}
		case "findOne": {
			const filter = body.filter ?? {};
			return `${handle}
row = ${receiver}.find_one(${pyDict(filter)})
print(row)`;
		}
		case "distinct": {
			const key = typeof body.key === "string" ? body.key : "";
			const filter = body.filter ?? {};
			return `${handle}
values = ${receiver}.distinct(${pyString(key)}, filter=${pyDict(filter)})
print(values)`;
		}
		case "countDocuments": {
			const filter = body.filter ?? {};
			const upper =
				typeof body.upperBound === "number" ? body.upperBound : 1000;
			return `${handle}
total = ${receiver}.count_documents(${pyDict(filter)}, upper_bound=${upper})
print(total)`;
		}
		case "insertOne": {
			const document = body.document ?? {};
			return `${handle}
result = ${receiver}.insert_one(${pyDict(document)})
print(result)`;
		}
		case "insertMany": {
			const documents = body.documents ?? [];
			return `${handle}
result = ${receiver}.insert_many(${pyValue(documents)})
print(result)`;
		}
		case "updateOne": {
			const filter = body.filter ?? {};
			const update = body.update ?? {};
			return `${handle}
result = ${receiver}.update_one(${pyDict(filter)}, ${pyDict(update)})
print(result)`;
		}
		case "updateMany": {
			const filter = body.filter ?? {};
			const update = body.update ?? {};
			return `${handle}
result = ${receiver}.update_many(${pyDict(filter)}, ${pyDict(update)})
print(result)`;
		}
		case "deleteOne": {
			const filter = body.filter ?? {};
			return `${handle}
result = ${receiver}.delete_one(${pyDict(filter)})
print(result)`;
		}
		case "deleteMany": {
			const filter = body.filter ?? {};
			return `${handle}
result = ${receiver}.delete_many(${pyDict(filter)})
print(result)`;
		}
		case "listIndexes": {
			return explainFlag(body)
				? `${handle}
indexes = ${receiver}.list_indexes()
print(indexes)`
				: `${handle}
names = ${receiver}.list_index_names()
print(names)`;
		}
		case "createIndex": {
			const definition = body.definition;
			if (
				definition &&
				typeof definition === "object" &&
				!Array.isArray(definition) &&
				typeof (definition as Record<string, unknown>).column === "string"
			) {
				const column = (definition as Record<string, unknown>).column as string;
				return `${handle}
${receiver}.create_index(${pyString(name)}, column=${pyString(column)})`;
			}
			return `${handle}
${receiver}.create_index(${pyString(name)}, definition=${pyDict(definition ?? {})})`;
		}
	}

	return null;
}

function generateJava({
	workspace,
	command,
	targetKind,
	targetName,
}: CodeContext) {
	const endpoint = endpointForCode(workspace, "java");
	const keyspaceArg = workspace.keyspace
		? `, ${javaString(workspace.keyspace)}`
		: "";

	const snippet = idiomaticJava(command, targetKind, targetName);
	if (snippet) {
		return `import com.datastax.astra.client.DataAPIClient;
import com.datastax.astra.client.databases.Database;
import com.datastax.astra.client.collections.Collection;
import com.datastax.astra.client.collections.definition.documents.Document;
import com.datastax.astra.client.tables.Table;
import com.datastax.astra.client.tables.definition.rows.Row;
import java.util.List;

DataAPIClient client = new DataAPIClient(System.getenv("ASTRA_DB_APPLICATION_TOKEN"));
Database db = client.getDatabase(${endpoint}${keyspaceArg});

${snippet}
`;
	}

	const keyspace = javaString(workspace.keyspace ?? "");
	const target = javaString(targetName ?? "");
	return `import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

String endpoint = ${endpoint};
String keyspace = ${keyspace};
String target = ${target};
String body = """
${formatJson(command)}
""";

String path = "/api/json/v1"
    + (keyspace.isEmpty() ? "" : "/" + keyspace)
    + (target.isEmpty() ? "" : "/" + target);

HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint + path))
    .header("Content-Type", "application/json")
    .header("Token", System.getenv("ASTRA_DB_APPLICATION_TOKEN"))
    .POST(HttpRequest.BodyPublishers.ofString(body))
    .build();

String result = HttpClient.newHttpClient()
    .send(request, HttpResponse.BodyHandlers.ofString())
    .body();
System.out.println(result);
`;
}

function idiomaticJava(
	command: Record<string, unknown>,
	targetKind: PlaygroundTargetKind,
	targetName: string | null,
): string | null {
	const extracted = extractCommand(command);
	if (!extracted) return null;
	const { op, body } = extracted;
	const name = typeof body.name === "string" ? body.name : "";

	switch (op) {
		case "findCollections": {
			return explainFlag(body)
				? `db.listCollections().forEach(System.out::println);`
				: `db.listCollectionNames().forEach(System.out::println);`;
		}
		case "createCollection": {
			return `Collection<Document> collection = db.createCollection(${javaString(name)});
System.out.println(collection.getName());`;
		}
		case "deleteCollection": {
			return `db.dropCollection(${javaString(name)});
System.out.println("Dropped ${name}");`;
		}
		case "listTables": {
			return explainFlag(body)
				? `db.listTables().forEach(System.out::println);`
				: `db.listTableNames().forEach(System.out::println);`;
		}
		case "dropTable": {
			return `db.dropTable(${javaString(name)});
System.out.println("Dropped ${name}");`;
		}
		case "dropIndex": {
			return `db.dropTableIndex(${javaString(name)});
System.out.println("Dropped index ${name}");`;
		}
		case "createTable": {
			return `// Build the table definition with the fluent TableDefinition API.
// db.createTable(${javaString(name)}, new TableDefinition()
//     .addColumnText("id")
//     .addPartitionBy("id"));`;
		}
	}

	if (!targetName) return null;
	const handle =
		targetKind === "table"
			? `Table<Row> table = db.getTable(${javaString(targetName)});`
			: `Collection<Document> collection = db.getCollection(${javaString(targetName)});`;
	const receiver = targetKind === "table" ? "table" : "collection";
	const docType = targetKind === "table" ? "Row" : "Document";

	switch (op) {
		case "find": {
			const filter = body.filter ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
${receiver}.find(filter).forEach(System.out::println);`;
		}
		case "findOne": {
			const filter = body.filter ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
${receiver}.findOne(filter).ifPresent(System.out::println);`;
		}
		case "distinct": {
			const key = typeof body.key === "string" ? body.key : "";
			const filter = body.filter ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
${receiver}.distinct(${javaString(key)}, filter, Object.class)
    .forEach(System.out::println);`;
		}
		case "countDocuments": {
			const filter = body.filter ?? {};
			const upper =
				typeof body.upperBound === "number" ? body.upperBound : 1000;
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
long total = ${receiver}.countDocuments(filter, ${upper});
System.out.println(total);`;
		}
		case "insertOne": {
			const document = body.document ?? {};
			return `${handle}
${docType} document = ${docType}.parse(${javaTextBlock(document)});
System.out.println(${receiver}.insertOne(document));`;
		}
		case "insertMany": {
			const documents = body.documents ?? [];
			return `${handle}
List<${docType}> documents = List.of(${javaDocList(documents, docType)});
System.out.println(${receiver}.insertMany(documents));`;
		}
		case "updateOne": {
			const filter = body.filter ?? {};
			const update = body.update ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
${docType} update = ${docType}.parse(${javaTextBlock(update)});
System.out.println(${receiver}.updateOne(filter, update));`;
		}
		case "updateMany": {
			const filter = body.filter ?? {};
			const update = body.update ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
${docType} update = ${docType}.parse(${javaTextBlock(update)});
System.out.println(${receiver}.updateMany(filter, update));`;
		}
		case "deleteOne": {
			const filter = body.filter ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
System.out.println(${receiver}.deleteOne(filter));`;
		}
		case "deleteMany": {
			const filter = body.filter ?? {};
			return `${handle}
${docType} filter = ${docType}.parse(${javaTextBlock(filter)});
System.out.println(${receiver}.deleteMany(filter));`;
		}
		case "listIndexes": {
			return explainFlag(body)
				? `${handle}
${receiver}.listIndexes().forEach(System.out::println);`
				: `${handle}
${receiver}.listIndexNames().forEach(System.out::println);`;
		}
		case "createIndex": {
			const definition = body.definition;
			if (
				definition &&
				typeof definition === "object" &&
				!Array.isArray(definition) &&
				typeof (definition as Record<string, unknown>).column === "string"
			) {
				const column = (definition as Record<string, unknown>).column as string;
				return `${handle}
${receiver}.createIndex(${javaString(name)}, ${javaString(column)});`;
			}
			return null;
		}
	}

	return null;
}

function pyValue(value: unknown): string {
	if (value === null) return "None";
	if (typeof value === "boolean") return value ? "True" : "False";
	if (typeof value === "number")
		return Number.isFinite(value) ? `${value}` : "None";
	if (typeof value === "string") return pyString(value);
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const items = value.map((item) => pyValue(item));
		return `[\n    ${items.join(",\n    ").replace(/\n/g, "\n    ")},\n]`;
	}
	if (typeof value === "object") {
		return pyDict(value as Record<string, unknown>);
	}
	return "None";
}

function pyDict(value: unknown): string {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return "{}";
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length === 0) return "{}";
	const lines = entries.map(
		([k, v]) =>
			`    ${pyString(k)}: ${indentLines(pyValue(v), "    ").trimStart()}`,
	);
	return `{\n${lines.join(",\n")},\n}`;
}

function pyKwargsFromOptions(options: Record<string, unknown>): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(options)) {
		const pyKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
		parts.push(`${pyKey}=${pyValue(value)}`);
	}
	return parts.join(", ");
}

function javaTextBlock(value: unknown): string {
	return `"""
${formatJson(value)}
"""`;
}

function javaDocList(value: unknown, docType: string): string {
	if (!Array.isArray(value) || value.length === 0) return "";
	return value
		.map((item) => `${docType}.parse(${javaTextBlock(item)})`)
		.join(", ");
}

function generateCurl({ workspace, command, targetName }: CodeContext) {
	const endpoint = endpointForCode(workspace, "curl");
	const keyspaceSegment = workspace.keyspace ? `/${workspace.keyspace}` : "";
	const targetSegment = targetName ? `/${targetName}` : "";
	return `curl -sS -X POST "${endpoint}/api/json/v1${keyspaceSegment}${targetSegment}" \\
  -H "Content-Type: application/json" \\
  -H "Token: $ASTRA_DB_APPLICATION_TOKEN" \\
  --data '${formatJson(command).replace(/'/g, "'\\''")}'
`;
}

function endpointForCode(workspace: Workspace, language: CodeLanguage): string {
	if (workspace.url && isLiteralUrl(workspace.url)) {
		if (language === "curl") return trimTrailingSlash(workspace.url);
		return language === "python"
			? pyString(workspace.url)
			: jsString(workspace.url);
	}
	if (language === "python") return 'os.environ["ASTRA_DB_API_ENDPOINT"]';
	if (language === "java") return 'System.getenv("ASTRA_DB_API_ENDPOINT")';
	if (language === "curl") return "$ASTRA_DB_API_ENDPOINT";
	return "process.env.ASTRA_DB_API_ENDPOINT!";
}

function isLiteralUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

function jsString(value: string): string {
	return JSON.stringify(value);
}

function pyString(value: string): string {
	return JSON.stringify(value);
}

function javaString(value: string): string {
	return JSON.stringify(value);
}

function targetLabel(kind: PlaygroundTargetKind): string {
	return kind === "table" ? "Table" : "Collection";
}
