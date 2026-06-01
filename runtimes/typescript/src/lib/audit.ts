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
import { mcpTrafficBuffer } from "./mcp-traffic-buffer.js";
import type { AppEnv } from "./types.js";

/**
 * All audit actions the runtime currently emits.
 *
 * The set is checked against [`docs/audit.md`](../../../../docs/audit.md)
 * by `tests/lib/audit-doc-drift.test.ts` — adding an action requires
 * adding a row in the doc table.
 */
export type AuditAction =
	| "api_key.create"
	| "api_key.revoke"
	| "workspace.create"
	| "workspace.delete"
	| "kb.create"
	| "kb.delete"
	| "document.delete"
	| "agent.create"
	| "agent.delete"
	| "job.claim"
	| "mcp.invoke"
	| "tool.invoke"
	| "auth.api_denied"
	| "auth.bootstrap_use"
	| "auth.csrf_rejected"
	| "auth.login"
	| "auth.logout"
	| "auth.refresh"
	| "auth.device.authorize"
	| "auth.device.token"
	// RLAC prototype audit actions.
	| "principal.create"
	| "principal.update"
	| "principal.delete";

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
	/** Document id (kb-scoped). */
	readonly documentId?: string;
	/** Agent id (workspace-scoped). */
	readonly agentId?: string;
	/** Agent template slug, when an agent was instantiated from the catalog. */
	readonly templateId?: string;
	/** Job id (workspace-scoped). */
	readonly jobId?: string;
	/** Job kind, e.g. "ingest". */
	readonly jobKind?: string;
	/** MCP tool name, e.g. "search_kb". */
	readonly toolName?: string;
	/**
	 * Tool source on a `tool.invoke` — `builtin` / `native` / `astra` /
	 * `mcp`. Lets SIEM rules filter external (`mcp`) calls from built-ins.
	 */
	readonly source?: string;
	/** MCP server id on an `mcp`-source `tool.invoke`. */
	readonly mcpServerId?: string;
	/** OIDC issuer or apiKey scheme on auth events. */
	readonly scheme?: string;
	/** Free-form reason for `failure` / `denied` outcomes. */
	readonly reason?: string;
	/**
	 * The privilege scope a caller was missing on a scope-gated
	 * `auth.api_denied`. Structured (vs. the free-form `reason`) so
	 * compliance can aggregate denials by scope. Absent on non-scope
	 * denials (workspace-membership checks / 401s).
	 */
	readonly requiredScope?: string;
	/** Caller-supplied label (workspace name, kb name, key label). */
	readonly label?: string;
	/**
	 * Comma-separated privilege scopes attached to an API key on
	 * mint. Recorded on `api_key.create` so compliance trails capture
	 * the exact scope set, not just whether scopes were requested.
	 */
	readonly scopes?: string;
	/** RLAC principal id (workspace-scoped). */
	readonly principalId?: string;
	/**
	 * Device-flow user code (the short alphanumeric code the operator
	 * types into their browser). Recorded on `auth.device.authorize`
	 * so the audit trail can correlate a /device/authorize call with
	 * its eventual /device/token poll outcome without holding the
	 * device_code (which would be enough material to complete the
	 * grant).
	 */
	readonly user_code?: string;
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
	readonly type: AuthSubject["type"] | "anonymous" | "system";
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
		recordMcpTraffic(envelope);
	} catch {
		// Audit logging is best-effort; never break the request path.
	}
}

/**
 * Emit an audit event from a non-request context — background workers
 * (orphan sweeper, scheduled jobs) that don't have a Hono request to
 * read `requestId` / `auth` from. The subject is synthesized from the
 * caller-supplied replica id so deployments can correlate the event
 * back to the replica that emitted it.
 */
export function auditSystem(event: AuditSystemEventInput): void {
	try {
		const envelope: AuditEnvelope = {
			audit: true,
			action: event.action,
			outcome: event.outcome,
			requestId: null,
			subject: { type: "system", id: event.replicaId, label: null },
			workspaceId: event.workspaceId ?? null,
			details: event.details ?? null,
		};
		logger.info(envelope, `audit ${event.action} ${event.outcome}`);
	} catch {
		// Audit logging is best-effort; never break the worker.
	}
}

export interface AuditSystemEventInput extends AuditEventInput {
	/** Replica id of the worker emitting the event. */
	readonly replicaId: string;
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

/**
 * Side-effect side-store. Drops anything that isn't an MCP invocation;
 * the in-memory buffer is for the Connect tab's "Recent integration
 * traffic" strip and only renders MCP calls today. Other audit actions
 * still hit the pino logger via the caller — see {@link audit}.
 *
 * Workspace id MUST be present for an MCP invoke (the route layer
 * always passes it) — drop quietly if it isn't.
 */
function recordMcpTraffic(envelope: AuditEnvelope): void {
	if (envelope.action !== "mcp.invoke") return;
	if (!envelope.workspaceId) return;
	const toolName = envelope.details?.toolName;
	if (!toolName) return;
	mcpTrafficBuffer.record({
		workspaceId: envelope.workspaceId,
		action: envelope.action,
		outcome: envelope.outcome,
		toolName,
		subjectType: envelope.subject?.type ?? "anonymous",
		subjectLabel: envelope.subject?.label ?? null,
		reason: envelope.details?.reason ?? null,
	});
}
