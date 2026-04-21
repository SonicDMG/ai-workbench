import type { Context } from "hono";
import type { ResolvedWorkspace } from "../workspaces/registry.js";
import type { AppEnv } from "./types.js";

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

export type AuthOk = { ok: true };
export type AuthFailure = {
	ok: false;
	status: 401 | 403;
	code: "missing_authorization" | "invalid_authorization" | "invalid_token";
	message: string;
};
export type AuthResult = AuthOk | AuthFailure;

/**
 * Enforce the workspace's declared auth kind against the inbound request.
 * - `kind: none` (or absent) → always ok.
 * - `kind: bearer` → require `Authorization: Bearer <token>` and match one
 *   of the tokens configured for the workspace.
 *
 * Returns a structured result; the caller is responsible for turning a
 * failure into an error envelope response.
 */
export function checkWorkspaceAuth(
	c: Context<AppEnv>,
	ws: ResolvedWorkspace,
): AuthResult {
	const auth = ws.config.auth;
	if (!auth || auth.kind === "none") return { ok: true };

	const header = c.req.header("Authorization");
	if (!header) {
		return {
			ok: false,
			status: 401,
			code: "missing_authorization",
			message: `Workspace '${ws.config.id}' requires Authorization: Bearer <token>`,
		};
	}

	const match = BEARER_PATTERN.exec(header);
	if (!match) {
		return {
			ok: false,
			status: 401,
			code: "invalid_authorization",
			message: "Authorization header must be of the form: Bearer <token>",
		};
	}

	const token = match[1]?.trim() ?? "";
	if (!token || !auth.tokens.includes(token)) {
		return {
			ok: false,
			status: 403,
			code: "invalid_token",
			message: `Token is not authorized for workspace '${ws.config.id}'`,
		};
	}
	return { ok: true };
}
