import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./types.js";

export class ApiError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly status: ContentfulStatusCode = 400,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export function errorEnvelope(
	c: Context<AppEnv>,
	code: string,
	message: string,
) {
	return {
		error: {
			code,
			message,
			requestId: c.get("requestId") ?? "unknown",
		},
	} as const;
}

export function errorResponse(c: Context<AppEnv>, err: ApiError) {
	return c.json(errorEnvelope(c, err.code, err.message), err.status);
}
