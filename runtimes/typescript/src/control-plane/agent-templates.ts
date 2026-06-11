/**
 * Agent template catalog — static personas the UI can offer when a
 * user wants a new agent without filling out the full create form.
 *
 * Templates are not stored records; they are runtime data shipped
 * alongside the binary. `templateId` is the stable slug
 * (lowercase-kebab) the wire surface uses. The catalog is intentionally
 * narrow — four personas — because the goal is "useful starting
 * points", not "expressive user-defined templates" (deferred per
 * ADR 0003).
 *
 * Two templates carry `defaultOnNewWorkspace: true` (Bobby, Maven);
 * those two are seeded automatically when a workspace is created so
 * the chat tab is non-empty out of the box. The other two are
 * opt-in — the UI offers them, but they don't appear in fresh
 * workspaces unless the user picks them.
 *
 * Adding a new template is a one-file change: append an entry,
 * decide if it's `defaultOnNewWorkspace`, ship. No migration, no
 * schema bump. See `docs/adr/0003-agent-templates.md` for the
 * decision context.
 */

import type { CreateAgentInput } from "./store.js";

/**
 * Shared "how to use the workspace tools" guidance appended to every
 * default agent's persona prompt. Spelling out the tool-selection
 * heuristic in the system prompt is more reliable than hoping the
 * model infers the right tool from descriptions alone — especially
 * for `gpt-4o-mini`, which under-uses tools without explicit nudging.
 */
export const DEFAULT_AGENT_TOOL_GUIDANCE =
	"When a question requires looking at the workspace's data, call " +
	"the right tool rather than guessing. Quick rules of thumb: \n" +
	"  - 'what's in my data?' / 'what knowledge bases do I have?' / " +
	"'how many documents?' → call `summarize_kb`, `list_kbs`, or " +
	"`count_documents`.\n" +
	"  - 'what documents do I have?' → call `list_documents`.\n" +
	"  - any specific content question (definitions, lookups, " +
	"explanations) → call `search_kb` with the user's phrasing.\n" +
	"  - asked about one specific document → call `get_document`.\n" +
	"If you don't know which knowledge bases exist, call `list_kbs` " +
	"first and pass the relevant `knowledgeBaseId` to `search_kb`; " +
	"omitting `knowledgeBaseId` searches every KB, which is fine when " +
	"the workspace has only one. Once your searches return enough " +
	"context (typically 1-2 calls), stop calling tools and answer — " +
	"never repeat a call with identical arguments.\n" +
	"After a tool returns, weave its output into the answer in your " +
	"own voice; cite individual chunks inline as `[chunk-uuid]` when " +
	"`search_kb` results inform the reply. If a tool returns no " +
	"results, say so plainly rather than hallucinating.";

export interface AgentTemplate {
	/** Stable slug. Lowercase kebab; never reused. */
	readonly templateId: string;
	/** Human-readable name applied to the agent on instantiation. */
	readonly name: string;
	/** One-line description shown in the catalog UI. */
	readonly description: string;
	/** Long-form persona blurb shown when the user picks the template. */
	readonly persona: string;
	/** System prompt baked into the agent on instantiation. */
	readonly systemPrompt: string;
	/**
	 * `true` → seeded into every freshly created workspace. `false` →
	 * available in the catalog but not seeded automatically. Flip
	 * with care: today's defaults pin the conformance fixture for
	 * workspace POST.
	 */
	readonly defaultOnNewWorkspace: boolean;
}

/**
 * The catalog. Iteration order is the display order. Slugs are stable
 * across releases; renaming a template requires a new slug + (if the
 * old slug was referenced anywhere) a redirect or graceful 404.
 */
export const AGENT_TEMPLATES: readonly AgentTemplate[] = Object.freeze([
	Object.freeze<AgentTemplate>({
		templateId: "bobby",
		name: "Bobby",
		description:
			"A no-nonsense data analyst. Direct, precise, and grounded — " +
			"Bobby gets to the point.",
		persona:
			"Direct, professional, terse. Good fit when you want answers " +
			"with the minimum of preamble — quick lookups, summaries, " +
			"audits.",
		systemPrompt:
			"You are Bobby, a professional and firm data assistant. Be " +
			"direct, concise, and precise. No filler, no apologies, no " +
			"unnecessary preamble. If a tool returns nothing useful, " +
			"say so plainly — do not speculate or hedge.\n\n" +
			DEFAULT_AGENT_TOOL_GUIDANCE,
		defaultOnNewWorkspace: true,
	}),
	Object.freeze<AgentTemplate>({
		templateId: "maven",
		name: "Maven",
		description:
			"A research assistant that synthesizes across multiple " +
			"sources. Thorough, even-handed, and explicit about its " +
			"sources.",
		persona:
			"Thorough and methodical. Good fit when an answer should " +
			"draw on more than one chunk and the user wants the " +
			"reasoning visible — literature reviews, comparative " +
			"summaries, due-diligence questions.",
		systemPrompt:
			"You are Maven, a careful research assistant. When a question " +
			"could draw on multiple sources, call `search_kb` with " +
			"deliberately broader phrasings to surface several relevant " +
			"chunks before answering. Synthesize the chunks in your own " +
			"voice — do not paste raw retrieval output — and cite each " +
			"supporting chunk inline as `[chunk-uuid]`. If sources " +
			"disagree, name the disagreement plainly. If the data " +
			"doesn't answer the question, say so and suggest what would.\n\n" +
			DEFAULT_AGENT_TOOL_GUIDANCE,
		defaultOnNewWorkspace: true,
	}),
	Object.freeze<AgentTemplate>({
		templateId: "quill",
		name: "Quill",
		description:
			"A technical writer. Concise, code-block savvy, prefers " +
			"showing the API call over describing it.",
		persona:
			"Concise and code-forward. Good fit for developer-facing Q&A — " +
			"how-tos, API lookups, code examples. Defaults to fenced " +
			"code blocks when the answer is a snippet.",
		systemPrompt:
			"You are Quill, a precise technical writer. Favor short " +
			"sentences and concrete examples. When the answer is or " +
			"includes code, return a fenced code block with a language " +
			"hint; do not narrate the code line-by-line unless asked. " +
			"Cite supporting chunks inline as `[chunk-uuid]`. If a tool " +
			"returns nothing relevant, say so and ask for the missing " +
			"detail rather than guessing.\n\n" +
			DEFAULT_AGENT_TOOL_GUIDANCE,
		defaultOnNewWorkspace: false,
	}),
	Object.freeze<AgentTemplate>({
		templateId: "sage",
		name: "Sage",
		description:
			"A grounded Q&A bot with strict retrieval defaults. Declines " +
			"confidently when the context can't support an answer.",
		persona:
			"Grounded and conservative. Good fit when hallucination is " +
			"the worst outcome — customer-facing FAQs, regulated content, " +
			"first-line support. Prefers 'I don't know' over a fluent guess.",
		systemPrompt:
			"You are Sage, a grounded Q&A assistant. Answer ONLY from " +
			"information returned by `search_kb` or other workspace " +
			"tools. If a `search_kb` call returns nothing relevant, " +
			"reply 'I don't have enough information to answer that' and " +
			"stop — do not paraphrase prior knowledge, do not extrapolate, " +
			"do not hedge with maybes. When you do answer, cite every " +
			"supporting chunk inline as `[chunk-uuid]`.\n\n" +
			DEFAULT_AGENT_TOOL_GUIDANCE,
		defaultOnNewWorkspace: false,
	}),
]);

/**
 * Lookup helper. Returns `null` for unknown slugs — callers map that
 * to HTTP 404 at the route layer.
 */
export function findAgentTemplate(templateId: string): AgentTemplate | null {
	return AGENT_TEMPLATES.find((t) => t.templateId === templateId) ?? null;
}

/**
 * Filter helper. The workspace POST handler uses this to derive its
 * default-seed list from the catalog instead of hard-coding it.
 */
export function defaultOnNewWorkspaceTemplates(): readonly AgentTemplate[] {
	return AGENT_TEMPLATES.filter((t) => t.defaultOnNewWorkspace);
}

/**
 * Translate a template into the `CreateAgentInput` shape the store
 * expects. The instantiation drops template-only fields (`templateId`,
 * `persona`, `defaultOnNewWorkspace`) and forwards `name`,
 * `description`, `systemPrompt`. Other agent fields default to the
 * `CreateAgentInput` defaults — callers can layer per-instantiation
 * overrides on top (e.g. wiring an `llmServiceId` discovered at
 * workspace-create time).
 */
export function templateToCreateAgentInput(
	template: AgentTemplate,
	overrides: Partial<CreateAgentInput> = {},
): CreateAgentInput {
	return {
		name: template.name,
		description: template.description,
		systemPrompt: template.systemPrompt,
		...overrides,
	};
}
