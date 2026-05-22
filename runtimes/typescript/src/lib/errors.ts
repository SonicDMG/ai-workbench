import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { docsPathFor, getErrorCode } from "./error-codes.js";
import type { AppEnv } from "./types.js";

/**
 * Optional fields the registry can attach to the error envelope so
 * the CLI and web UI can render remediation hints + a docs link
 * without parsing the human message.
 */
export interface ApiErrorOptions {
	readonly status?: ContentfulStatusCode;
	readonly hint?: string;
	readonly docs?: string;
}

/**
 * Canonical thrown error for HTTP route handlers. Constructor accepts
 * either a bare status (legacy call shape) or an options object so
 * call sites can override hint/docs without restating status.
 *
 * When `code` is present in {@link ../error-codes.REGISTRY}, the
 * default status, hint, and docs path are pulled from the registry —
 * so `new ApiError("kb_name_taken", "…")` is enough; the constructor
 * fills in 409 + the canonical hint automatically.
 */
export class ApiError extends Error {
	public readonly status: ContentfulStatusCode;
	public readonly hint: string | undefined;
	public readonly docs: string | undefined;

	constructor(
		public readonly code: string,
		message: string,
		statusOrOpts?: ContentfulStatusCode | ApiErrorOptions,
	) {
		super(message);
		this.name = "ApiError";
		const opts: ApiErrorOptions =
			typeof statusOrOpts === "object" && statusOrOpts !== null
				? statusOrOpts
				: { status: statusOrOpts };
		const registry = getErrorCode(code);
		this.status = opts.status ?? registry?.defaultStatus ?? 400;
		this.hint = opts.hint ?? registry?.hint;
		this.docs = opts.docs ?? docsPathFor(code);
	}
}

export interface ErrorEnvelopeFields {
	readonly code: string;
	readonly message: string;
	readonly requestId: string;
	readonly hint?: string;
	readonly docs?: string;
}

export interface ErrorEnvelope {
	readonly error: ErrorEnvelopeFields;
}

/**
 * Build the canonical error envelope for the response body. Accepts
 * either:
 *   - a string `code` + message (+ optional hint/docs override) — the
 *     registry is consulted to populate any missing hint/docs.
 *   - a fully constructed {@link ApiError} — hint/docs are taken from
 *     the instance.
 *
 * Always emits `requestId` so the client can correlate the failure
 * with the runtime's structured logs.
 */
export function errorEnvelope(
	c: Context<AppEnv>,
	code: string,
	message: string,
	opts?: { hint?: string; docs?: string },
): ErrorEnvelope;
export function errorEnvelope(c: Context<AppEnv>, err: ApiError): ErrorEnvelope;
export function errorEnvelope(
	c: Context<AppEnv>,
	codeOrErr: string | ApiError,
	message?: string,
	opts?: { hint?: string; docs?: string },
): ErrorEnvelope {
	if (codeOrErr instanceof ApiError) {
		return buildEnvelope(c, {
			code: codeOrErr.code,
			message: codeOrErr.message,
			hint: codeOrErr.hint,
			docs: codeOrErr.docs,
		});
	}
	const registry = getErrorCode(codeOrErr);
	return buildEnvelope(c, {
		code: codeOrErr,
		message: message ?? "",
		hint: opts?.hint ?? registry?.hint,
		docs: opts?.docs ?? docsPathFor(codeOrErr),
	});
}

function buildEnvelope(
	c: Context<AppEnv>,
	fields: {
		code: string;
		message: string;
		hint?: string;
		docs?: string;
	},
): ErrorEnvelope {
	const requestId = c.get("requestId") ?? "unknown";
	const envelope: ErrorEnvelopeFields = {
		code: fields.code,
		message: fields.message,
		requestId,
		...(fields.hint ? { hint: fields.hint } : {}),
		...(fields.docs ? { docs: fields.docs } : {}),
	};
	return { error: envelope };
}

export function errorResponse(c: Context<AppEnv>, err: ApiError) {
	return c.json(errorEnvelope(c, err), err.status);
}
