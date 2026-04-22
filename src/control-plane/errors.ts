/**
 * Typed errors surfaced by any {@link ./store.ControlPlaneStore} implementation.
 *
 * The route layer maps these to HTTP envelopes:
 *   NotFoundError   → 404 `*_not_found`
 *   ConflictError   → 409 `*_conflict`
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

export class ControlPlaneConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ControlPlaneConflictError";
	}
}

export class ControlPlaneUnavailableError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "ControlPlaneUnavailableError";
	}
}
