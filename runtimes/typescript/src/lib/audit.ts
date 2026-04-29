/**
 * Structured audit logging for sensitive operations.
 *
 * Every audit event is emitted as a single pino log line at `info`
 * with the discriminator field `audit: true` so deployments can route
 * them to a dedicated sink (file, syslog, SIEM) by filter:
 *
 *     {"level":30,"time":...,"audit":true,
 *      "action":"api_key.create","outcome":"success",
 *      "requestId":"...","subject":{"type":"oidc","id":"sub-123"},
 *      "workspaceId":"ws-...","resource":{"keyId":"..."}}
 *
 * Design rules:
 *   - **No secret material.** Never pass plaintext tokens, refresh
 *     tokens, hashes, OAuth codes, or PII payloads into `details`. The
 *     `redact` allowlist in {@link auditDetails} keeps callers honest
 *     by only forwarding fields it recognizes.
 *   - **Stable action names.** `<resource>.<verb>` in snake_case. Never
 *     rename in place — add a new action and keep the old one until
 *     downstream consumers migrate.
 *   - **Outcome is always set.** `success` | `failure` | `denied` so
 *     SIEM rules can alert on bursts of `denied` without parsing
 *     status codes.
 *   - **Best-effort, never throws.** Audit logging must not break the
 *     request path. The wrapper swallows logger errors.
 *
 * The events documented in [`docs/audit.md`](../../../../docs/audit.md)
 * are the contract; new call sites must update that doc.
 */

import type { Context } from "hono";
import type { AuthContext, AuthSubject } from "../auth/types.js";
import { logger } from "./logger.js";
import type { AppEnv } from "./types.js";

/** All audit actions the runtime currently emits. */
export type AuditAction =
	| "api_key.create"
	| "api_key.revoke"
	| "workspace.create"
	| "workspace.delete"
	| "knowledge_base.create"
	| "knowledge_base.delete"
	| "auth.login"
	| "auth.logout"
	| "auth.refresh"
	| "auth.bootstrap_use";

export type AuditOutcome = "success" | "failure" | "denied";

/**
 * Allowed fields for the `details` map. We accept arbitrary
 * record values in code, but only these shapes are documented and
 * downstream consumers can rely on them.
 */
export interface AuditDetails {
	/** Key id (never the plaintext or hash). */
	readonly keyId?: string;
	/** Knowledge base id. */
	readonly knowledgeBaseId?: string;
	/** OIDC issuer or apiKey scheme on auth events. */
	readonly scheme?: string;
	/** Free-form reason for `failure` / `denied` outcomes. */
	readonly reason?: string;
	/** Caller-supplied label (workspace name, kb name, key label). */
	readonly label?: string;
}

export interface AuditEventInput {
	readonly action: AuditAction;
	readonly outcome: AuditOutcome;
	/** Workspace the action targets, if applicable. */
	readonly workspaceId?: string | null;
	/** Resource identifiers — see {@link AuditDetails}. */
	readonly details?: AuditDetails;
}

interface AuditEnvelope {
	readonly audit: true;
	readonly action: AuditAction;
	readonly outcome: AuditOutcome;
	readonly requestId: string | null;
	readonly subject: AuditSubjectEnvelope | null;
	readonly workspaceId: string | null;
	readonly details: AuditDetails | null;
}

interface AuditSubjectEnvelope {
	readonly type: AuthSubject["type"] | "anonymous";
	readonly id: string | null;
	readonly label: string | null;
}

/**
 * Emit an audit event. Reads `requestId` and `auth` from the Hono
 * context so callers don't have to thread them.
 *
 * Best-effort: any logger error is swallowed so a failed audit write
 * never breaks the request.
 */
export function audit(c: Context<AppEnv>, event: AuditEventInput): void {
	try {
		const requestId = c.get("requestId") ?? null;
		const auth: AuthContext | null = c.get("auth") ?? null;
		const subject = auth ? toSubjectEnvelope(auth) : null;
		const envelope: AuditEnvelope = {
			audit: true,
			action: event.action,
			outcome: event.outcome,
			requestId,
			subject,
			workspaceId: event.workspaceId ?? null,
			details: event.details ?? null,
		};
		logger.info(envelope, `audit ${event.action} ${event.outcome}`);
	} catch {
		// Audit logging is best-effort; never break the request path.
	}
}

function toSubjectEnvelope(auth: AuthContext): AuditSubjectEnvelope {
	if (!auth.authenticated || !auth.subject) {
		return { type: "anonymous", id: null, label: null };
	}
	return {
		type: auth.subject.type,
		id: auth.subject.id,
		label: auth.subject.label,
	};
}
