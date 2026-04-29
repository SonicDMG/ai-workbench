import ReactMarkdown, { type Components } from "react-markdown";
import { Link } from "react-router-dom";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * One chunk Bobbie cited in this turn. Built from
 * `metadata.context_chunks` on a {@link ChatMessage}.
 */
export interface ChunkRef {
	readonly chunkId: string;
	readonly knowledgeBaseId: string;
	/** May be `null` when the vector store didn't carry the
	 * `documentId` in the chunk's payload. The link still works —
	 * it lands on the KB explorer with `?chunk=<id>`. */
	readonly documentId: string | null;
}

interface MarkdownContentProps {
	readonly content: string;
	readonly workspaceId: string;
	/**
	 * Resolved chunk → (KB, document) map for `[chunkId]` citation
	 * linkbacks. Pass an empty map (or omit) to render markdown
	 * without rewriting any citations.
	 */
	readonly chunkMap?: ReadonlyMap<string, ChunkRef>;
	readonly className?: string;
}

const CITATION_RE = /\[([A-Za-z0-9_:-]+)\](?!\()/g;

/**
 * Build the deep-link URL for a `[chunkId]` citation. Lands on the KB
 * explorer with `?document=<docId>&chunk=<chunkId>` so the explorer
 * can auto-open {@link DocumentDetailDialog} and scroll the matching
 * chunk into view.
 */
function citationHref(workspaceId: string, ref: ChunkRef): string {
	const params = new URLSearchParams();
	if (ref.documentId) params.set("document", ref.documentId);
	params.set("chunk", ref.chunkId);
	return `/workspaces/${workspaceId}/knowledge-bases/${ref.knowledgeBaseId}?${params.toString()}`;
}

/**
 * Pre-process the markdown source so each bare `[chunkId]` reference
 * (with chunkId present in the map) becomes a regular markdown link
 * `[chunkId](url)`. The negative-lookahead `(?!\()` skips patterns
 * the LLM has already rendered as proper links.
 */
export function injectCitations(
	markdown: string,
	chunkMap: ReadonlyMap<string, ChunkRef>,
	workspaceId: string,
): string {
	if (chunkMap.size === 0) return markdown;
	return markdown.replace(CITATION_RE, (match, chunkId: string) => {
		const ref = chunkMap.get(chunkId);
		if (!ref) return match;
		return `[${chunkId}](${citationHref(workspaceId, ref)})`;
	});
}

/**
 * Renders Bobbie's assistant content as sanitized GitHub-flavored
 * markdown, with `[chunkId]` citation references rewritten into
 * clickable links to the KB explorer.
 *
 * Internal links (citations + any other path-relative URLs the model
 * happens to emit) render as react-router `<Link>` so navigation
 * doesn't reload the page; external links open in a new tab.
 *
 * Sanitization runs through rehype-sanitize with the default GitHub
 * schema, so even if the LLM emits raw HTML, no scripts / event
 * handlers / unsafe protocols make it to the DOM.
 */
export function MarkdownContent({
	content,
	workspaceId,
	chunkMap,
	className,
}: MarkdownContentProps): JSX.Element {
	const map = chunkMap ?? EMPTY_MAP;
	const source = injectCitations(content, map, workspaceId);
	return (
		<div className={cn("markdown-content space-y-2", className)}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeSanitize]}
				components={MARKDOWN_COMPONENTS}
			>
				{source}
			</ReactMarkdown>
		</div>
	);
}

const EMPTY_MAP: ReadonlyMap<string, ChunkRef> = new Map();

const MARKDOWN_COMPONENTS: Components = {
	a({ href, children, ...rest }) {
		if (typeof href === "string" && href.startsWith("/")) {
			return (
				<Link
					to={href}
					className="font-medium text-[var(--color-brand-700)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
					data-testid="chat-citation-link"
				>
					{children}
				</Link>
			);
		}
		return (
			<a
				href={href}
				target="_blank"
				rel="noreferrer noopener"
				className="font-medium text-[var(--color-brand-700)] underline underline-offset-2 hover:decoration-solid"
				{...rest}
			>
				{children}
			</a>
		);
	},
	code({ className, children, ...rest }) {
		// react-markdown renders inline code (`x`) and fenced blocks
		// through the same `code` component. Distinguish by the
		// language hint that gets attached to fenced blocks.
		const isBlock =
			typeof className === "string" && /language-/.test(className);
		if (isBlock) {
			return (
				<code
					className={cn(
						"block overflow-x-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100",
						className,
					)}
					{...rest}
				>
					{children}
				</code>
			);
		}
		return (
			<code
				className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[12px] text-slate-900"
				{...rest}
			>
				{children}
			</code>
		);
	},
	pre({ children, ...rest }) {
		// `code` already styles fenced blocks; let `pre` pass through
		// transparently so we don't double-pad.
		return <pre {...rest}>{children}</pre>;
	},
	ul({ children }) {
		return <ul className="list-disc space-y-0.5 pl-5">{children}</ul>;
	},
	ol({ children }) {
		return <ol className="list-decimal space-y-0.5 pl-5">{children}</ol>;
	},
	h1({ children }) {
		return <h1 className="text-base font-semibold">{children}</h1>;
	},
	h2({ children }) {
		return <h2 className="text-sm font-semibold">{children}</h2>;
	},
	h3({ children }) {
		return <h3 className="text-sm font-semibold">{children}</h3>;
	},
	blockquote({ children }) {
		return (
			<blockquote className="border-l-2 border-slate-300 pl-3 text-slate-700 italic">
				{children}
			</blockquote>
		);
	},
	table({ children }) {
		return (
			<div className="overflow-x-auto">
				<table className="text-xs border-collapse">{children}</table>
			</div>
		);
	},
	th({ children }) {
		return (
			<th className="border border-slate-300 bg-slate-100 px-2 py-1 text-left font-medium">
				{children}
			</th>
		);
	},
	td({ children }) {
		return (
			<td className="border border-slate-300 px-2 py-1 align-top">
				{children}
			</td>
		);
	},
};

/**
 * Parse `metadata.context_chunks` (JSON-encoded compact tuple array)
 * into a Map keyed by `chunkId`. Falls back to the older
 * `context_document_ids` (comma-joined chunk IDs only — no KB / doc
 * info) and produces entries with empty IDs so the UI knows about
 * the chunk even though it can't link to the document.
 *
 * Tolerant of partial / malformed input — returns an empty map and
 * logs a one-line console warning rather than throwing into a render.
 */
export function parseChunkMap(
	metadata: Readonly<Record<string, string>>,
): ReadonlyMap<string, ChunkRef> {
	const out = new Map<string, ChunkRef>();
	const json = metadata.context_chunks;
	if (typeof json === "string" && json.length > 0) {
		try {
			const parsed = JSON.parse(json) as unknown;
			if (Array.isArray(parsed)) {
				for (const row of parsed) {
					if (!Array.isArray(row) || row.length < 2) continue;
					const [chunkId, kbId, docId] = row;
					if (typeof chunkId !== "string" || typeof kbId !== "string") continue;
					out.set(chunkId, {
						chunkId,
						knowledgeBaseId: kbId,
						documentId: typeof docId === "string" ? docId : null,
					});
				}
				return out;
			}
		} catch {
			// fall through to legacy parse
		}
	}
	const legacy = metadata.context_document_ids;
	if (typeof legacy === "string" && legacy.length > 0) {
		for (const id of legacy.split(",")) {
			const trimmed = id.trim();
			if (trimmed.length === 0) continue;
			out.set(trimmed, {
				chunkId: trimmed,
				knowledgeBaseId: "",
				documentId: null,
			});
		}
	}
	return out;
}
