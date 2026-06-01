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

	/**
	 * The privilege scope the caller was missing, when this denial came
	 * from a scope gate (`assertScope` / `requireScope`). Surfaced as a
	 * structured `requiredScope` field on the `auth.api_denied` audit row
	 * so compliance can aggregate denials by scope. Undefined for non-scope
	 * denials (workspace-membership / platform-access checks).
	 */
	constructor(
		message: string,
		readonly requiredScope?: string,
	) {
		super(message);
		this.name = "ForbiddenError";
	}
}
