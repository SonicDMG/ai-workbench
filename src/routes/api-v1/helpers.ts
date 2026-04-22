/**
 * Maps typed {@link ../../control-plane/errors} exceptions to the
 * canonical HTTP envelope.
 *
 * Called from the top-level {@link ../../app.createApp} `onError`
 * handler — route handlers can throw `ControlPlane*Error` normally and
 * get correct status codes without wrapping every call in try/catch
 * (which would also fight OpenAPIHono's typed-response inference).
 */

import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
	ControlPlaneConflictError,
	ControlPlaneNotFoundError,
	ControlPlaneUnavailableError,
} from "../../control-plane/errors.js";

export interface MappedError {
	readonly status: ContentfulStatusCode;
	readonly code: string;
	readonly message: string;
}

export function mapControlPlaneError(err: unknown): MappedError | null {
	if (err instanceof ControlPlaneNotFoundError) {
		return {
			status: 404,
			code: `${err.resource.replace(/\s+/g, "_")}_not_found`,
			message: err.message,
		};
	}
	if (err instanceof ControlPlaneConflictError) {
		return { status: 409, code: "conflict", message: err.message };
	}
	if (err instanceof ControlPlaneUnavailableError) {
		return {
			status: 503,
			code: "control_plane_unavailable",
			message: err.message,
		};
	}
	return null;
}
