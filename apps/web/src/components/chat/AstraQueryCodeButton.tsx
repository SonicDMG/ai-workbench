import type { ElementContent, Root, RootContent } from "hast";
import { common, createLowlight } from "lowlight";
import { Check, Code2, Copy } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	CODE_LANGUAGES,
	type CodeLanguage,
	generateCode,
} from "@/lib/astra-codegen";
import type { AstraQuerySnapshot, ChatMessage } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * Lowlight registry preloaded with the languages this dialog renders
 * (tabs map TS / Python / Java / cURL onto hljs language ids). Built
 * once at module load — the registry is mutable and reusable.
 */
const lowlight = createLowlight(common);

/** Map our `CodeLanguage` discriminator onto an hljs language id. */
const HLJS_LANGUAGE: Readonly<Record<CodeLanguage, string>> = {
	typescript: "typescript",
	python: "python",
	java: "java",
	curl: "bash",
};

/**
 * Subtle "view client code" affordance on assistant message bubbles
 * whose retrieval hit Astra. Renders nothing when the persisted
 * `metadata.astra_queries` is missing / malformed / empty (non-Astra
 * workspaces or turns where the model didn't call `search_kb`) so the
 * chat surface stays clean for turns that don't have anything to show.
 *
 * Click → modal with four tabs (TS / Python / Java / cURL); each
 * tab has a "Copy" button. The query text and topK come from the
 * envelope; tokens + endpoint are deliberately placeholder env vars
 * because those values are never captured server-side.
 */
export function AstraQueryCodeButton({ message }: { message: ChatMessage }) {
	const queries = useMemo(
		() => parseAstraQueries(message.metadata.astra_queries),
		[message.metadata.astra_queries],
	);
	if (queries.length === 0) return null;

	return (
		<Dialog>
			<DialogTrigger asChild>
				<button
					type="button"
					className={cn(
						"inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
						"text-slate-400 hover:bg-slate-100 hover:text-[var(--color-brand-700)]",
						"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
						"transition-colors",
					)}
					title="View the Astra Data API query AI Workbench made for this reply"
					aria-label="View Astra client code for this reply"
					data-testid="astra-query-code-button"
				>
					<Code2 className="h-3 w-3" aria-hidden="true" />
					<span>code</span>
				</button>
			</DialogTrigger>
			<DialogContent className="max-w-3xl">
				<DialogHeader>
					<DialogTitle>Astra Data API query</DialogTitle>
					<DialogDescription>
						{queries.length === 1
							? `The exact call AI Workbench made against ${queries[0]?.kbName ?? "this knowledge base"} to ground this reply.`
							: `${queries.length} calls AI Workbench made to ground this reply. Switch knowledge bases below.`}
					</DialogDescription>
				</DialogHeader>
				<AstraQueryCodeView queries={queries} />
			</DialogContent>
		</Dialog>
	);
}

function AstraQueryCodeView({
	queries,
}: {
	queries: readonly AstraQuerySnapshot[];
}) {
	const firstQuery = queries[0];
	const [activeKb, setActiveKb] = useState<string>(
		firstQuery ? firstQuery.knowledgeBaseId : "",
	);
	const [language, setLanguage] = useState<CodeLanguage>("typescript");
	const snapshot =
		queries.find((q) => q.knowledgeBaseId === activeKb) ?? firstQuery;
	if (!snapshot) return null;
	const code = generateCode(language, snapshot);

	return (
		<div className="flex flex-col gap-3">
			{queries.length > 1 ? (
				<div className="flex flex-wrap gap-1.5">
					{queries.map((q) => (
						<button
							key={q.knowledgeBaseId}
							type="button"
							onClick={() => setActiveKb(q.knowledgeBaseId)}
							className={cn(
								"rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
								q.knowledgeBaseId === activeKb
									? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
									: "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
							)}
							data-testid="astra-query-code-kb-tab"
						>
							{q.kbName}
						</button>
					))}
				</div>
			) : null}

			<div className="flex flex-wrap gap-1.5 border-b border-slate-200">
				{CODE_LANGUAGES.map((opt) => (
					<button
						key={opt.id}
						type="button"
						onClick={() => setLanguage(opt.id)}
						className={cn(
							"rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
							opt.id === language
								? "border-[var(--color-brand-600)] text-[var(--color-brand-700)]"
								: "border-transparent text-slate-500 hover:text-slate-900",
						)}
						data-testid="astra-query-code-lang-tab"
						aria-current={opt.id === language}
					>
						{opt.label}
					</button>
				))}
			</div>

			<CodeBlock code={code} language={language} />

			<div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
				<p>
					<span className="font-medium">Note:</span> tokens and endpoint URLs
					are read from <code className="font-mono">$ASTRA_DB_*</code> env vars
					— they aren't captured server-side, so you'll fill them in when
					running the snippet.
				</p>
			</div>
		</div>
	);
}

/**
 * Render a lowlight hast tree as JSX. Handles the only three node
 * kinds lowlight emits: `root`, `element` (always `<span>` with
 * `className: ["hljs-…"]`), and `text`. Anything else is dropped.
 *
 * Tiny by design — pulling in `hast-util-to-jsx-runtime` would add a
 * dependency for a tree shape that's known and finite here.
 */
function renderHastChildren(
	children: readonly (RootContent | ElementContent)[] | undefined,
): ReactNode {
	if (!children) return null;
	// Index keys are safe here: lowlight rebuilds the entire token tree
	// whenever the input code or language changes, so siblings are
	// never reordered between renders — they're either re-emitted from
	// the same source position or replaced wholesale.
	return children.map((child, idx) => {
		if (child.type === "text") {
			// biome-ignore lint/suspicious/noArrayIndexKey: see comment above on `children.map`.
			return <Fragment key={idx}>{child.value}</Fragment>;
		}
		if (child.type === "element") {
			const className = child.properties?.className;
			const cn = Array.isArray(className) ? className.join(" ") : undefined;
			return (
				// biome-ignore lint/suspicious/noArrayIndexKey: see comment above on `children.map`.
				<span key={idx} className={cn}>
					{renderHastChildren(child.children)}
				</span>
			);
		}
		return null;
	});
}

function highlight(code: string, language: CodeLanguage): Root {
	try {
		return lowlight.highlight(HLJS_LANGUAGE[language], code);
	} catch {
		// Unknown language, malformed input — fall back to a plain-text
		// hast root so the dialog still renders the snippet.
		return { type: "root", children: [{ type: "text", value: code }] };
	}
}

function CodeBlock({
	code,
	language,
}: {
	code: string;
	language: CodeLanguage;
}) {
	const [copied, setCopied] = useState(false);
	async function handleCopy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard API can fail in older browsers / cross-origin
			// frames; the user can still copy manually from the rendered
			// block.
		}
	}
	return (
		<div className="relative">
			<button
				type="button"
				onClick={handleCopy}
				className={cn(
					"absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium",
					"border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
					"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
				)}
				aria-label={copied ? "Copied" : "Copy code"}
				data-testid="astra-query-code-copy"
			>
				{copied ? (
					<>
						<Check className="h-3 w-3" aria-hidden="true" />
						Copied
					</>
				) : (
					<>
						<Copy className="h-3 w-3" aria-hidden="true" />
						Copy
					</>
				)}
			</button>
			<pre
				className="max-h-[60vh] overflow-auto rounded-md border border-slate-200 bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"
				data-testid="astra-query-code-block"
			>
				<code className="hljs">
					{renderHastChildren(highlight(code, language).children)}
				</code>
			</pre>
		</div>
	);
}

/**
 * Parse the persisted `metadata.astra_queries` JSON. Tolerant of
 * absence + malformed shapes — returns `[]` rather than throwing so a
 * single bad row never breaks the chat render.
 */
function parseAstraQueries(raw: string | undefined): AstraQuerySnapshot[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const out: AstraQuerySnapshot[] = [];
		for (const item of parsed) {
			if (
				typeof item === "object" &&
				item !== null &&
				typeof item.knowledgeBaseId === "string" &&
				typeof item.kbName === "string" &&
				typeof item.collection === "string" &&
				typeof item.query === "object" &&
				item.query !== null &&
				typeof item.query.text === "string" &&
				typeof item.query.topK === "number"
			) {
				out.push({
					knowledgeBaseId: item.knowledgeBaseId,
					kbName: item.kbName,
					collection: item.collection,
					keyspace: typeof item.keyspace === "string" ? item.keyspace : null,
					query: { text: item.query.text, topK: item.query.topK },
				});
			}
		}
		return out;
	} catch {
		return [];
	}
}
