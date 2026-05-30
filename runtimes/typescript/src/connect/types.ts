/**
 * Shared types for the workspace **Connect** surface — the per-
 * framework recipe library that lets an external agent stack
 * (LangGraph, CrewAI, Google ADK, Microsoft Agent Framework, IBM
 * watsonx Agent Builder) treat an AI Workbench workspace as a
 * pluggable component.
 *
 * Snippet generators are pure functions of {@link SnippetContext}; the
 * route just iterates over the registry and renders. Keeping the
 * rendering out of the route module makes the strings easy to unit-
 * test, and keeps the wire shape (`ConnectSnippet`) decoupled from any
 * specific framework's idioms.
 */

/**
 * Stable identifiers for the framework targets we render snippets for.
 * Adding a target is an append-only change; renaming is a wire-break.
 */
export type ConnectTargetId =
	| "langgraph"
	| "crewai"
	| "google-adk"
	| "microsoft-agent-framework"
	| "watsonx"
	| "mcp-raw";

/**
 * Source language of the snippet — drives syntax highlighting and the
 * file extension on the **Download** affordance in the UI.
 */
export type SnippetLanguage = "python" | "typescript" | "bash" | "text";

/**
 * Transport the snippet uses against the runtime.
 *
 *   - `mcp`     — the snippet wires an MCP client at
 *                 `/api/v1/workspaces/{w}/mcp`. Requires `mcp.enabled`.
 *   - `rest`    — direct calls to `/api/v1/*`.
 *   - `manual`  — no code; configuration steps the user performs in
 *                 another product's UI (e.g. pasting the MCP URL into
 *                 watsonx Agent Builder's tool dialog).
 */
export type SnippetTransport = "mcp" | "rest" | "manual";

/**
 * Inputs every generator gets. The route layer resolves these once per
 * request; generators stay pure.
 *
 * Auth: we never echo a plaintext secret back to the caller. The
 * snippet uses {@link apiKeyEnvVar} as a `process.env` / `os.environ`
 * indirection so the secret stays in the user's environment, not in
 * the snippet body the UI shows on a shared screen.
 */
export interface SnippetContext {
	/** The workspace the snippets are scoped to. Always present. */
	readonly workspaceId: string;
	/**
	 * Optional KB to bake into the snippet. When set, retrieval-tool
	 * defaults narrow to this KB; when null, snippets retrieve across
	 * the whole workspace.
	 */
	readonly knowledgeBaseId: string | null;
	/**
	 * Public base URL of the runtime, with no trailing slash. Resolved
	 * via {@link resolvePublicBaseUrl} so reverse-proxy and dev-server
	 * cases produce the URL the customer can actually reach.
	 */
	readonly publicBaseUrl: string;
	/**
	 * Whether the runtime has `mcp.enabled: true`. MCP-transport
	 * snippets stay in the response either way, but carry a warning
	 * flag the UI surfaces; this prevents customers from copying a
	 * snippet that will 404 silently.
	 */
	readonly mcpEnabled: boolean;
	/**
	 * Name of the environment variable the snippet reads the API key
	 * from. Defaults to `WORKBENCH_API_KEY` so all snippets are
	 * consistent.
	 */
	readonly apiKeyEnvVar: string;
}

/**
 * The wire shape returned from `GET /connect/snippets`. Mirrored by a
 * Zod schema in `openapi/schemas.ts`.
 */
export interface ConnectSnippet {
	/** Stable id — see {@link ConnectTargetId}. */
	readonly id: ConnectTargetId;
	/** Human-readable name, e.g. "LangGraph", "Google ADK". */
	readonly displayName: string;
	/** Short blurb shown beside the snippet. */
	readonly tagline: string;
	readonly language: SnippetLanguage;
	readonly transport: SnippetTransport;
	/**
	 * `pip install …` / `npm install …` / similar. `null` for manual
	 * targets that don't install anything.
	 */
	readonly install: string | null;
	/** The snippet body, fully token-substituted, ready to paste. */
	readonly code: string;
	/**
	 * When true, the snippet only works when the runtime has
	 * `mcp.enabled: true`. The UI uses this to render a "Enable MCP in
	 * workbench.yaml first" warning when the runtime feature flag is
	 * off.
	 */
	readonly requiresMcp: boolean;
	/**
	 * Link to the framework's own docs for additional context. The UI
	 * renders it as the "Open framework docs" affordance.
	 */
	readonly docsUrl: string;
	/**
	 * Optional caveats — gotchas, version requirements, things that
	 * deserve a yellow "note" callout next to the snippet.
	 */
	readonly notes: string | null;
}

/**
 * The contract every framework module implements.
 */
export type SnippetGenerator = (ctx: SnippetContext) => ConnectSnippet;
