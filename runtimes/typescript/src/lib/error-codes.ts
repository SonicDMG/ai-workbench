/**
 * Error-code registry — single source of truth for every stable
 * `code` string the API returns inside its error envelope.
 *
 * Each entry carries:
 *  - `defaultStatus`: the HTTP status code paired with the error. Used
 *    by `ApiError` when no explicit `status` argument is passed, so
 *    throw sites can degrade to `new ApiError("kb_name_taken", "…")`
 *    without restating that this is a 409.
 *  - `hint`: a one-line, action-oriented remediation rendered next to
 *    the message in the CLI and web UI.
 *  - `docsAnchor`: the fragment under `docs/errors.md` (and the
 *    Scalar-rendered API reference) where the long-form explanation
 *    lives. The envelope serializer expands this into `docs/errors.md#<anchor>`.
 *
 * Adding a new code:
 *   1. Add a record to `REGISTRY` below.
 *   2. Throw it via `new ApiError("your_code", "human message")`.
 *   3. Run `npm test -- error-codes` — the orphan test will fail if the
 *      code is thrown but unregistered, or if a registry entry is
 *      missing a hint / anchor.
 *   4. Regenerate `docs/errors.md` via `npm run docs:errors`.
 *
 * Dynamic codes (`<resource>_not_found` from `ControlPlaneNotFoundError`,
 * `<service>_in_use` from `ControlPlaneConflictError`) are listed
 * explicitly so the docs page and the CLI's `--explain` flag can
 * surface them. The resource → not-found code mapping is enumerated
 * in `RESOURCE_NOT_FOUND_CODES` for reference.
 */

import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ErrorCodeDescriptor {
	readonly code: string;
	readonly defaultStatus: ContentfulStatusCode;
	readonly hint: string;
	readonly docsAnchor: string;
}

/** Anchor used to build `docs` URLs in the error envelope. */
function anchorOf(code: string): string {
	return code.replace(/_/g, "-");
}

function entry(
	code: string,
	defaultStatus: ContentfulStatusCode,
	hint: string,
): readonly [string, ErrorCodeDescriptor] {
	return [
		code,
		{ code, defaultStatus, hint, docsAnchor: anchorOf(code) },
	] as const;
}

const REGISTRY = new Map<string, ErrorCodeDescriptor>([
	// --- auth ---
	entry(
		"unauthorized",
		401,
		"Provide a valid API key or OIDC token via the Authorization header.",
	),
	entry(
		"forbidden",
		403,
		"Your principal is authenticated but lacks the required scope or workspace access.",
	),
	entry(
		"forbidden_origin",
		403,
		"The request Origin/Referer does not match the configured publicOrigin; check your reverse proxy.",
	),

	// --- request shape ---
	entry(
		"validation_error",
		400,
		"Request body or query string failed schema validation; see the message for the offending field.",
	),
	entry(
		"invalid_cursor",
		400,
		"The pagination cursor is malformed or expired; restart pagination from the first page.",
	),
	entry(
		"invalid_metadata",
		400,
		"The metadata object must be a shallow record of string-keyed JSON-safe values.",
	),
	entry(
		"invalid_multipart",
		400,
		"The multipart/form-data body could not be parsed; check the Content-Type boundary.",
	),
	entry(
		"invalid_visible_to",
		400,
		"The visibleTo field must be a non-empty array of principal IDs or '*'.",
	),
	entry(
		"missing_file",
		400,
		"The request must include a `file` part in the multipart body.",
	),
	entry(
		"empty_file",
		400,
		"The uploaded file is zero bytes; check the source path before retrying.",
	),
	entry(
		"payload_too_large",
		413,
		"Request body exceeded the per-route ceiling; split the payload or use the multipart ingest endpoint for large files.",
	),

	// --- generic CRUD ---
	entry(
		"not_found",
		404,
		"The route or resource does not exist; check the URL and the active workspace.",
	),
	entry(
		"conflict",
		409,
		"The resource already exists or its state changed underneath you; refetch and retry.",
	),
	entry(
		"internal_error",
		500,
		"An unexpected error occurred; check the runtime logs with the requestId for the full stack.",
	),
	entry(
		"draining",
		503,
		"The runtime is shutting down and is no longer accepting new requests; retry against another replica.",
	),
	entry(
		"rate_limited",
		429,
		"You hit the per-IP rate limit; back off and retry, or raise runtime.rateLimit.capacity.",
	),

	// --- control plane ---
	entry(
		"control_plane_unavailable",
		503,
		"The control-plane backend is unreachable; verify Astra connectivity or the file driver path.",
	),
	entry(
		"cascade_incomplete",
		500,
		"A workspace delete partially failed across Astra partitions; the workspace was left intact — retry the delete to complete the idempotent cascade.",
	),
	entry(
		"workspace_not_found",
		404,
		"The workspace does not exist or your principal cannot see it; run `aiw workspace list` to verify.",
	),
	entry(
		"knowledge_base_not_found",
		404,
		"The knowledge base does not exist in this workspace; run `aiw kb list --workspace <id>`.",
	),
	entry(
		"document_not_found",
		404,
		"The document is not in this knowledge base; document IDs are scoped per-KB.",
	),
	entry(
		"agent_not_found",
		404,
		"The agent does not exist in this workspace; create one before sending messages.",
	),
	entry(
		"agent_template_not_found",
		404,
		"The agent template is not registered; pick one from `GET /api/v1/agent-templates`.",
	),
	entry(
		"conversation_not_found",
		404,
		"The conversation does not exist for this agent; conversations are scoped per-agent.",
	),
	entry(
		"chat_not_found",
		404,
		"The chat thread does not exist for this workspace.",
	),
	entry(
		"chat_message_not_found",
		404,
		"The chat message does not exist in this conversation.",
	),
	entry(
		"chunking_service_not_found",
		404,
		"The chunking service is not configured in this workspace.",
	),
	entry(
		"embedding_service_not_found",
		404,
		"The embedding service is not configured in this workspace.",
	),
	entry(
		"reranking_service_not_found",
		404,
		"The reranking service is not configured in this workspace.",
	),
	entry(
		"llm_service_not_found",
		404,
		"The LLM service is not configured in this workspace.",
	),
	entry("api_key_not_found", 404, "The API key does not exist or was revoked."),
	entry(
		"job_not_found",
		404,
		"The job ID does not exist or its retention window has elapsed.",
	),
	entry(
		"knowledge_filter_not_found",
		404,
		"The knowledge filter is not defined in this workspace.",
	),
	entry(
		"principal_not_found",
		404,
		"The principal does not exist in this workspace's RLAC table.",
	),

	// --- in-use conflicts (service deletion blocked by referencing record) ---
	entry(
		"chunking_service_in_use",
		409,
		"At least one knowledge base binds this chunking service; rebind the KBs before deleting.",
	),
	entry(
		"embedding_service_in_use",
		409,
		"At least one knowledge base binds this embedding service; rebind the KBs before deleting.",
	),
	entry(
		"reranking_service_in_use",
		409,
		"At least one knowledge base binds this reranking service; rebind the KBs before deleting.",
	),
	entry(
		"llm_service_in_use",
		409,
		"At least one agent binds this LLM service; rebind the agents before deleting.",
	),

	// --- KB + vector store provisioning ---
	entry(
		"workspace_name_conflict",
		409,
		"A workspace with this name already exists; pick a unique name.",
	),
	entry(
		"workspace_database_conflict",
		409,
		"Another workspace is already bound to this (endpoint, keyspace); reuse it or pick a different keyspace.",
	),
	entry(
		"kb_name_taken",
		409,
		"A knowledge base with this name already exists in the workspace; pick a unique name.",
	),
	entry(
		"kb_name_must_match_collection",
		400,
		"The KB name must equal the existing collection name when adopting an Astra collection.",
	),
	entry(
		"collection_name_taken",
		409,
		"An Astra collection with this name already exists; choose another or adopt the existing one.",
	),
	entry(
		"collection_not_found",
		404,
		"The Astra collection does not exist; create it first or check the spelling.",
	),
	entry(
		"collection_unavailable",
		503,
		"The Astra collection is temporarily unreachable; retry with backoff.",
	),
	entry(
		"vector_collection_required",
		400,
		"This operation requires a vector-enabled collection; recreate it with a vector dimension.",
	),
	entry(
		"vector_collection_not_allowed",
		400,
		"This operation targets a non-vector collection; remove the vector field from the request.",
	),
	entry(
		"vectorize_service_mismatch",
		400,
		"The KB's embedding service does not match the collection's $vectorize service definition.",
	),
	entry(
		"unsupported_workspace_kind",
		422,
		"This operation is not implemented for the workspace's backend kind.",
	),
	entry(
		"workspace_misconfigured",
		422,
		"The workspace is missing required configuration (credentials, endpoint, or keyspace).",
	),
	entry(
		"driver_unavailable",
		503,
		"The vector-store driver registered for this workspace failed to initialize.",
	),
	entry(
		"data_api_error",
		502,
		"The Astra Data API returned an error; check Astra status and the runtime logs.",
	),
	entry(
		"data_api_unavailable",
		503,
		"The Astra Data API is unreachable or timed out; retry with backoff.",
	),
	entry(
		"dimension_mismatch",
		400,
		"The vector dimension does not match the collection's configured dimension.",
	),
	entry(
		"embedding_dimension_mismatch",
		400,
		"The embedding service returned a vector whose dimension does not match the collection.",
	),
	entry(
		"embedding_unavailable",
		503,
		"The embedding provider is unreachable or rejected the request; check the service credentials.",
	),

	// --- ingest + search dispatch ---
	entry(
		"invalid_chunker",
		400,
		"The chunker name is not registered; valid chunkers are listed at `GET /api/v1/chunkers`.",
	),
	entry(
		"invalid_parser",
		400,
		"The parser name is not registered for this MIME type.",
	),
	entry(
		"hybrid_not_supported",
		501,
		"The active vector-store driver does not support hybrid (lexical+vector) search.",
	),
	entry(
		"rerank_not_supported",
		501,
		"The active vector-store driver does not support reranking; set rerank=false.",
	),
	entry(
		"list_records_not_supported",
		501,
		"This driver does not expose a list-records operation; use search instead.",
	),

	// --- agents + chat ---
	entry(
		"chat_disabled",
		503,
		"No chat provider is configured; uncomment the `chat` block in workbench.yaml or bind an LLM service to the agent.",
	),
	entry(
		"llm_provider_unsupported",
		422,
		"The agent's LLM service uses a provider this runtime cannot dispatch; choose openrouter, openai, or ollama (HuggingFace was removed in 0.3.0).",
	),
	entry(
		"llm_credential_missing",
		503,
		"The LLM provider credential could not be resolved; check the credentialsRef on the service.",
	),
	entry(
		"llm_model_not_chat",
		422,
		"The model is not served for chat completion; pick an instruct/chat model.",
	),
	entry(
		"llm_model_unavailable",
		422,
		"The provider does not serve this model; check the model id (e.g. an OpenRouter slug like `openai/gpt-4o-mini`) and that your account/credits can route it.",
	),

	// --- playground ---
	entry(
		"invalid_playground_command",
		400,
		"The playground command name or argument shape is invalid; see /docs for the supported command list.",
	),

	// --- setup wizard ---
	entry(
		"setup_restart_unavailable",
		503,
		"This runtime did not register a restart hook; restart the container manually (`docker compose restart workbench`).",
	),

	// --- RLAC policy ---
	entry(
		"policy_principal_required",
		401,
		"This route requires a resolved sub-workspace principal; ensure your token carries the principal claim.",
	),
	entry(
		"policy_denied",
		403,
		"The active principal is not permitted to access this resource by the workspace's RLAC policy.",
	),
]);

/** Reverse map: `ControlPlaneNotFoundError` resource → registered code. */
export const RESOURCE_NOT_FOUND_CODES: Readonly<Record<string, string>> = {
	workspace: "workspace_not_found",
	"knowledge base": "knowledge_base_not_found",
	document: "document_not_found",
	agent: "agent_not_found",
	agent_template: "agent_template_not_found",
	conversation: "conversation_not_found",
	chat: "chat_not_found",
	"chat message": "chat_message_not_found",
	"chunking service": "chunking_service_not_found",
	"embedding service": "embedding_service_not_found",
	"reranking service": "reranking_service_not_found",
	"llm service": "llm_service_not_found",
	api_key: "api_key_not_found",
	job: "job_not_found",
	"knowledge filter": "knowledge_filter_not_found",
	principal: "principal_not_found",
};

/** Returns the registry entry for `code`, or `undefined` if unregistered. */
export function getErrorCode(code: string): ErrorCodeDescriptor | undefined {
	return REGISTRY.get(code);
}

/** Snapshot of all registered codes, sorted by code. */
export function listErrorCodes(): readonly ErrorCodeDescriptor[] {
	return [...REGISTRY.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * The path appended to the runtime's docs root for an error code's
 * long-form documentation. Stays relative so the CLI and web UI can
 * decide whether to render it as a fragment or expand against a base
 * URL (the public docs site, GitHub blob view, etc).
 */
export function docsPathFor(code: string): string | undefined {
	const entry = REGISTRY.get(code);
	if (!entry) return undefined;
	return `docs/errors.md#${entry.docsAnchor}`;
}
