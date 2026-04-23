/**
 * Auth errors. The top-level `onError` handler maps them to the
 * canonical envelope; codes are stable and documented in
 * `docs/api-spec.md`.
 */

export class UnauthorizedError extends Error {
	readonly code = "unauthorized";
	readonly status = 401;

	constructor(
		message: string,
		readonly scheme: string = "Bearer",
	) {
		super(message);
		this.name = "UnauthorizedError";
	}
}

export class ForbiddenError extends Error {
	readonly code = "forbidden";
	readonly status = 403;

	constructor(message: string) {
		super(message);
		this.name = "ForbiddenError";
	}
}
