/**
 * Typed errors surfaced by any {@link ./store.ControlPlaneStore} implementation.
 *
 * The route layer maps these to HTTP envelopes:
 *   NotFoundError    → 404 `*_not_found`
 *   ConflictError    → 409 (default `conflict`, or `code` from the throw site)
 *   UnavailableError → 503 `control_plane_unavailable`
 *
 * Backends must throw these (not generic `Error`) so the mapping stays
 * uniform regardless of which store is active.
 */

export class ControlPlaneNotFoundError extends Error {
	constructor(
		public readonly resource: string,
		public readonly id: string,
	) {
		super(`${resource} '${id}' not found`);
		this.name = "ControlPlaneNotFoundError";
	}
}

/**
 * `code` defaults to `"conflict"` for the legacy generic case
 * (duplicate ids, double-create races). Specialized in-use deletions
 * (`chunking_service_in_use`, `llm_service_in_use`, …) override it so
 * clients can react without parsing the message.
 */
export class ControlPlaneConflictError extends Error {
	public readonly code: string;
	constructor(message: string, code = "conflict") {
		super(message);
		this.name = "ControlPlaneConflictError";
		this.code = code;
	}
}

/**
 * Specialized 409 codes for "you tried to delete a service that is
 * still bound to a KB or agent" cases. Keyed by the foreign-key
 * field name on the referencing record so the throw site can synthesize
 * the right code from whichever field it scanned.
 */
export const IN_USE_CODES = {
	embeddingServiceId: "embedding_service_in_use",
	chunkingServiceId: "chunking_service_in_use",
	rerankingServiceId: "reranking_service_in_use",
	llmServiceId: "llm_service_in_use",
} as const;

export class ControlPlaneUnavailableError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "ControlPlaneUnavailableError";
	}
}
