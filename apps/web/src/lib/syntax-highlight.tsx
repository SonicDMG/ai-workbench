/**
 * Shared syntax-highlighting primitive. Wraps `lowlight` + a small
 * hast → React renderer so any surface that wants colored code can
 * just render `<HighlightedCode language="python" code="…" />`
 * without rebuilding the registry or repeating the hast traversal.
 *
 * Two callers today:
 *   - `AstraCodeChip` (TypeScript / Python / Java / cURL — Astra
 *     Data API snapshots in chat and CRUD surfaces)
 *   - `ConnectPage` snippet view (Python / TypeScript / Bash / Text
 *     — per-framework recipes)
 *
 * Building `createLowlight(common)` once at module load is the whole
 * reason this lives outside both components: lowlight's `common`
 * preset bundles ~35 languages and we only want to pay that cost
 * once per page load, not per render.
 */

import type { ElementContent, Root, RootContent } from "hast";
import { common, createLowlight } from "lowlight";
import { Fragment, type ReactNode } from "react";

const lowlight = createLowlight(common);

/**
 * Languages every surface in the app uses. Adding one is a single
 * line here plus a registry entry — the renderer is language-
 * agnostic past this map.
 */
export type SupportedLanguage =
	| "typescript"
	| "python"
	| "java"
	| "bash"
	| "text";

const HLJS_LANGUAGE: Readonly<Record<SupportedLanguage, string | null>> = {
	typescript: "typescript",
	python: "python",
	java: "java",
	bash: "bash",
	// `text` is a sentinel — the snippet is plain text, so we
	// short-circuit lowlight and render the raw string. Returning a
	// hljs language id of `null` keeps the type narrow.
	text: null,
};

function highlightToHast(code: string, language: SupportedLanguage): Root {
	const hljsId = HLJS_LANGUAGE[language];
	if (hljsId === null) {
		return { type: "root", children: [{ type: "text", value: code }] };
	}
	try {
		return lowlight.highlight(hljsId, code);
	} catch {
		// Unknown language id or malformed input — fall back to plain
		// text so the surface still renders something useful.
		return { type: "root", children: [{ type: "text", value: code }] };
	}
}

function renderHastChildren(
	children: readonly (RootContent | ElementContent)[] | undefined,
): ReactNode {
	if (!children) return null;
	// Index keys are safe: lowlight rebuilds the entire token tree
	// whenever the input changes, so siblings are never reordered
	// across renders.
	return children.map((child, idx) => {
		if (child.type === "text") {
			// biome-ignore lint/suspicious/noArrayIndexKey: see comment above.
			return <Fragment key={idx}>{child.value}</Fragment>;
		}
		if (child.type === "element") {
			const className = child.properties?.className;
			const cn = Array.isArray(className) ? className.join(" ") : undefined;
			return (
				// biome-ignore lint/suspicious/noArrayIndexKey: see comment above.
				<span key={idx} className={cn}>
					{renderHastChildren(child.children)}
				</span>
			);
		}
		return null;
	});
}

export interface HighlightedCodeProps {
	readonly code: string;
	readonly language: SupportedLanguage;
}

/**
 * Render `code` with hljs token classes wrapped in `<span>`s. The
 * caller is responsible for the surrounding `<pre>` / theme styling
 * (so the same component can sit in a dark code block or an inline
 * help snippet).
 */
export function HighlightedCode({
	code,
	language,
}: HighlightedCodeProps): ReactNode {
	return (
		<code className="hljs">
			{renderHastChildren(highlightToHast(code, language).children)}
		</code>
	);
}
