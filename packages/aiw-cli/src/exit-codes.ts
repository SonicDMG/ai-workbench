/**
 * Documented exit codes for the `aiw` CLI.
 *
 * Scripts wrapping `aiw` should branch on these rather than the bare
 * `0/non-zero` split — they're stable across releases and let a CI
 * pipeline tell "the runtime is down" (`UNAVAILABLE`) apart from
 * "the user supplied a bad flag" (`USAGE_ERROR`).
 *
 * The mapping from server error code → exit code is intentionally
 * narrow: only the categories a script can meaningfully react to
 * differently. Anything else collapses into `RUNTIME_ERROR`.
 */

export const ExitCode = {
	OK: 0,
	RUNTIME_ERROR: 1,
	USAGE_ERROR: 2,
	AUTH_ERROR: 3,
	NOT_FOUND: 4,
	CONFLICT: 5,
	UNAVAILABLE: 6,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Server error codes that map to a specific CLI exit code. Everything
 * else falls through to the HTTP-status heuristic in
 * {@link exitCodeForHttpError}.
 */
const CODE_TO_EXIT: Readonly<Record<string, ExitCodeValue>> = {
	// 401 / 403 — auth/authz
	unauthorized: ExitCode.AUTH_ERROR,
	forbidden: ExitCode.AUTH_ERROR,
	forbidden_origin: ExitCode.AUTH_ERROR,
	policy_principal_required: ExitCode.AUTH_ERROR,
	policy_denied: ExitCode.AUTH_ERROR,
	// 404 — missing
	not_found: ExitCode.NOT_FOUND,
	workspace_not_found: ExitCode.NOT_FOUND,
	knowledge_base_not_found: ExitCode.NOT_FOUND,
	document_not_found: ExitCode.NOT_FOUND,
	agent_not_found: ExitCode.NOT_FOUND,
	agent_template_not_found: ExitCode.NOT_FOUND,
	conversation_not_found: ExitCode.NOT_FOUND,
	chat_not_found: ExitCode.NOT_FOUND,
	chat_message_not_found: ExitCode.NOT_FOUND,
	chunking_service_not_found: ExitCode.NOT_FOUND,
	embedding_service_not_found: ExitCode.NOT_FOUND,
	reranking_service_not_found: ExitCode.NOT_FOUND,
	llm_service_not_found: ExitCode.NOT_FOUND,
	api_key_not_found: ExitCode.NOT_FOUND,
	job_not_found: ExitCode.NOT_FOUND,
	knowledge_filter_not_found: ExitCode.NOT_FOUND,
	principal_not_found: ExitCode.NOT_FOUND,
	collection_not_found: ExitCode.NOT_FOUND,
	// 409 — conflict
	conflict: ExitCode.CONFLICT,
	workspace_name_conflict: ExitCode.CONFLICT,
	workspace_database_conflict: ExitCode.CONFLICT,
	kb_name_taken: ExitCode.CONFLICT,
	collection_name_taken: ExitCode.CONFLICT,
	chunking_service_in_use: ExitCode.CONFLICT,
	embedding_service_in_use: ExitCode.CONFLICT,
	reranking_service_in_use: ExitCode.CONFLICT,
	llm_service_in_use: ExitCode.CONFLICT,
	// 503 / 504 — temporary unavailability worth retrying
	control_plane_unavailable: ExitCode.UNAVAILABLE,
	driver_unavailable: ExitCode.UNAVAILABLE,
	collection_unavailable: ExitCode.UNAVAILABLE,
	data_api_unavailable: ExitCode.UNAVAILABLE,
	embedding_unavailable: ExitCode.UNAVAILABLE,
	chat_disabled: ExitCode.UNAVAILABLE,
	llm_credential_missing: ExitCode.UNAVAILABLE,
	draining: ExitCode.UNAVAILABLE,
	rate_limited: ExitCode.UNAVAILABLE,
	network_error: ExitCode.UNAVAILABLE,
};

/**
 * Map a server-side error code + HTTP status to a documented exit
 * code. Looks up the registry mapping first, then degrades to a
 * status-based heuristic for unknown codes.
 */
export function exitCodeForHttpError(
	code: string | undefined,
	status: number,
): ExitCodeValue {
	if (code && code in CODE_TO_EXIT) {
		return CODE_TO_EXIT[code] ?? ExitCode.RUNTIME_ERROR;
	}
	if (status >= 500) return ExitCode.UNAVAILABLE;
	if (status === 404) return ExitCode.NOT_FOUND;
	if (status === 409) return ExitCode.CONFLICT;
	if (status === 401 || status === 403) return ExitCode.AUTH_ERROR;
	if (status >= 400) return ExitCode.RUNTIME_ERROR;
	return ExitCode.OK;
}
