/**
 * Generic "view client code" affordance for any Astra Data API
 * operation. Renders a small `<> code` chip that opens a modal with
 * KB tabs (when multiple snapshots target multiple KBs) + language
 * tabs (TypeScript / Python / Java / cURL) + a copy button.
 *
 * Surfaces (chat retrieval, KB create, ingest, document delete,
 * playground search) all mount this same component with a pre-built
 * snapshot list. The chip is consciously subtle — same `text-slate-400
 * hover:text-brand-700` weight as the existing chat surface — so it
 * never competes with primary actions for attention.
 *
 * Returns `null` when there are no snapshots; non-Astra workspaces
 * never accumulate snapshots, so the chip stays hidden automatically
 * for mock / file-backed workspaces without surface-level gating.
 *
 * Two modes:
 *   - `variant: "actual"` (default) — the call already executed.
 *     Trigger reads "code", dialog title is "Astra Data API query".
 *   - `variant: "preview"` — the call is about to execute (e.g. on
 *     the KB-create form, or the delete confirmation modal). Same
 *     chip, but copy explicitly says "preview" so users understand
 *     the call hasn't been made yet.
 *
 * `footer` lets surfaces add a one-line caveat under the code block
 * (the ingest chip uses this to note "repeated for each batch").
 */

import type { ElementContent, Root, RootContent } from "hast";
import { common, createLowlight } from "lowlight";
import { Check, Code2, Copy, Eye } from "lucide-react";
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
import type { AstraQuerySnapshot } from "@/lib/schemas";
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

export type AstraCodeChipVariant = "actual" | "preview";

export interface AstraCodeChipProps {
	readonly snapshots: readonly AstraQuerySnapshot[];
	readonly variant?: AstraCodeChipVariant;
	/** Override the trigger button label. Defaults to "code" /
	 * "preview". */
	readonly triggerLabel?: string;
	/** Override the trigger button tooltip + aria-label root. */
	readonly triggerTitle?: string;
	/** Override the dialog header title. */
	readonly dialogTitle?: string;
	/** Override the dialog header description. Single-snapshot
	 * surfaces typically want their own copy; the default is
	 * derived from the snapshot kind. */
	readonly dialogDescription?: ReactNode;
	/** One-line caveat rendered below the code block. The ingest
	 * surface uses this to note that the captured `insertMany` call
	 * is repeated for each chunk batch. */
	readonly footer?: ReactNode;
	/** Test id for the trigger button (the dialog itself is portaled
	 * out of the trigger's DOM tree, so e2e tests need to anchor on
	 * the trigger to open it). */
	readonly testId?: string;
}

export function AstraCodeChip({
	snapshots,
	variant = "actual",
	triggerLabel,
	triggerTitle,
	dialogTitle,
	dialogDescription,
	footer,
	testId,
}: AstraCodeChipProps) {
	if (snapshots.length === 0) return null;
	const isPreview = variant === "preview";
	const label = triggerLabel ?? (isPreview ? "preview" : "code");
	const title =
		triggerTitle ??
		(isPreview
			? "Preview the Astra Data API call AI Workbench will make"
			: "View the Astra Data API call AI Workbench made");
	const Icon = isPreview ? Eye : Code2;
	const headerTitle =
		dialogTitle ??
		(isPreview ? "Astra Data API call (preview)" : "Astra Data API call");

	return (
		<Dialog>
			<DialogTrigger asChild>
				<button
					type="button"
					className={cn(
						"inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
						"text-slate-400 hover:bg-slate-100 hover:text-[var(--color-brand-700)] dark:text-slate-500 dark:hover:bg-slate-800",
						"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
						"transition-colors",
					)}
					title={title}
					aria-label={title}
					data-testid={testId ?? "astra-code-chip"}
				>
					<Icon className="h-3 w-3" aria-hidden="true" />
					<span>{label}</span>
				</button>
			</DialogTrigger>
			<DialogContent className="max-w-3xl">
				<DialogHeader>
					<DialogTitle>{headerTitle}</DialogTitle>
					<DialogDescription>
						{dialogDescription ?? defaultDescription(snapshots, isPreview)}
					</DialogDescription>
				</DialogHeader>
				<AstraCodeView snapshots={snapshots} footer={footer} />
			</DialogContent>
		</Dialog>
	);
}

/**
 * Default dialog description, picked from the snapshot's `kind`. Most
 * surfaces will override this with surface-specific copy; the
 * defaults still need to read naturally for surfaces that don't.
 */
function defaultDescription(
	snapshots: readonly AstraQuerySnapshot[],
	isPreview: boolean,
): string {
	const tense = isPreview ? "will run" : "ran";
	if (snapshots.length > 1) {
		return `${snapshots.length} calls AI Workbench ${tense} against your database. Switch between them below.`;
	}
	const first = snapshots[0];
	if (!first) return "";
	const target = first.kbName ?? "this knowledge base";
	switch (first.kind) {
		case "vector_search":
			return `The exact vector search AI Workbench ${tense} against ${target}.`;
		case "list_chunks":
			return `The chunk-listing call AI Workbench ${tense} against ${target}.`;
		case "create_collection":
			return `The collection-creation call AI Workbench ${tense} to provision ${target}.`;
		case "insert_chunks":
			return `One representative chunk-batch insert AI Workbench ${tense} during ingest into ${target}.`;
		case "delete_by_document":
			return `The cascade delete AI Workbench ${tense} to drop a document's chunks from ${target}.`;
		case "delete_chunk":
			return `The single-chunk delete AI Workbench ${tense} against ${target}.`;
	}
}

// Tab key is `${knowledgeBaseId}:${kind}` so the same KB can carry
// multiple distinct calls (e.g. an ingest-time `insert_chunks` next
// to a preview `create_collection`) without collapsing onto one tab.
// Hoisted to module scope so React's hooks dependency check sees a
// stable identity — the function is pure and has no closure deps.
function tabKey(s: AstraQuerySnapshot): string {
	return `${s.knowledgeBaseId}:${s.kind}`;
}

function AstraCodeView({
	snapshots,
	footer,
}: {
	snapshots: readonly AstraQuerySnapshot[];
	footer?: ReactNode;
}) {
	const first = snapshots[0];
	const [activeKey, setActiveKey] = useState<string>(
		first ? tabKey(first) : "",
	);
	const [language, setLanguage] = useState<CodeLanguage>("typescript");
	const snapshot = useMemo(
		() => snapshots.find((s) => tabKey(s) === activeKey) ?? first,
		[snapshots, activeKey, first],
	);
	if (!snapshot) return null;
	const code = generateCode(language, snapshot);

	return (
		<div className="flex flex-col gap-3">
			{snapshots.length > 1 ? (
				<div className="flex flex-wrap gap-1.5">
					{snapshots.map((s) => {
						const key = tabKey(s);
						return (
							<button
								key={key}
								type="button"
								onClick={() => setActiveKey(key)}
								className={cn(
									"rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
									key === activeKey
										? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
										: "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-100",
								)}
								data-testid="astra-code-chip-snapshot-tab"
							>
								{tabLabel(s)}
							</button>
						);
					})}
				</div>
			) : null}

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
						data-testid="astra-code-chip-lang-tab"
						aria-current={opt.id === language}
					>
						{opt.label}
					</button>
				))}
			</div>

			<CodeBlock code={code} language={language} />

			{footer ? (
				<div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
					{footer}
				</div>
			) : null}

			<div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
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
 * Short label for the tab pill — KB name for read shapes, KB name +
 * a kind hint for write shapes so a surface that captures both a
 * `create_collection` and an `insert_chunks` against the same KB
 * stays readable.
 */
function tabLabel(s: AstraQuerySnapshot): string {
	switch (s.kind) {
		case "vector_search":
		case "list_chunks":
			return s.kbName;
		case "create_collection":
			return `${s.kbName} · create`;
		case "insert_chunks":
			return `${s.kbName} · insert`;
		case "delete_by_document":
		case "delete_chunk":
			return `${s.kbName} · delete`;
	}
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
					"border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100",
					"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
				)}
				aria-label={copied ? "Copied" : "Copy code"}
				data-testid="astra-code-chip-copy"
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
				className="max-h-[60vh] overflow-auto rounded-md border border-slate-200 bg-slate-900 p-4 text-xs leading-relaxed text-slate-100 dark:border-slate-800 dark:bg-slate-950"
				data-testid="astra-code-chip-block"
			>
				<code className="hljs">
					{renderHastChildren(highlight(code, language).children)}
				</code>
			</pre>
		</div>
	);
}

/**
 * Parse a persisted `metadata.astra_queries` JSON blob. Tolerant of
 * absence + malformed shapes — returns `[]` rather than throwing so
 * a single bad row never breaks the surface using it.
 *
 * Back-compat: rows persisted before the discriminator existed have
 * no `kind` field and a `query: { text, topK }` shape. They decode
 * as `kind: "vector_search"`.
 *
 * Public so the chat-message wrapper (and any future persisted
 * surface) can share the back-compat logic without re-implementing
 * it.
 */
export function parseAstraSnapshotsBlob(
	raw: string | undefined,
): AstraQuerySnapshot[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const out: AstraQuerySnapshot[] = [];
		for (const item of parsed) {
			const snapshot = parseOneSnapshot(item);
			if (snapshot) out.push(snapshot);
		}
		return out;
	} catch {
		return [];
	}
}

function parseOneSnapshot(item: unknown): AstraQuerySnapshot | null {
	if (typeof item !== "object" || item === null) return null;
	const r = item as Record<string, unknown>;
	if (
		typeof r.knowledgeBaseId !== "string" ||
		typeof r.kbName !== "string" ||
		typeof r.collection !== "string"
	) {
		return null;
	}
	const keyspace = typeof r.keyspace === "string" ? r.keyspace : null;
	// Legacy: no `kind`, has top-level `query.text` + `query.topK`.
	const kind = typeof r.kind === "string" ? r.kind : "vector_search";

	if (kind === "vector_search") {
		const q = pickQuery(r);
		if (!q) return null;
		if (typeof q.text !== "string" || typeof q.topK !== "number") return null;
		return {
			kind: "vector_search",
			knowledgeBaseId: r.knowledgeBaseId,
			kbName: r.kbName,
			collection: r.collection,
			keyspace,
			query: { text: q.text, topK: q.topK },
		};
	}
	if (kind === "list_chunks") {
		const q = pickQuery(r);
		if (!q) return null;
		if (
			typeof q.documentId !== "string" ||
			typeof q.limit !== "number" ||
			typeof q.offset !== "number"
		) {
			return null;
		}
		return {
			kind: "list_chunks",
			knowledgeBaseId: r.knowledgeBaseId,
			kbName: r.kbName,
			collection: r.collection,
			keyspace,
			query: { documentId: q.documentId, limit: q.limit, offset: q.offset },
		};
	}
	// The remaining shapes (create_collection / insert_chunks / etc.)
	// aren't currently persisted — they're built and surfaced in the
	// same response cycle. Parsing them here keeps the back-compat
	// path symmetric in case a future surface persists them.
	if (
		kind === "create_collection" ||
		kind === "insert_chunks" ||
		kind === "delete_by_document" ||
		kind === "delete_chunk"
	) {
		// Defer schema validation to the Zod parser the caller uses to
		// validate fresh API responses. The persistence path doesn't
		// currently produce these, so returning `null` here is fine —
		// callers shouldn't see them in legacy blobs.
		return null;
	}
	return null;
}

function pickQuery(r: Record<string, unknown>): Record<string, unknown> | null {
	if (typeof r.query !== "object" || r.query === null) return null;
	return r.query as Record<string, unknown>;
}
