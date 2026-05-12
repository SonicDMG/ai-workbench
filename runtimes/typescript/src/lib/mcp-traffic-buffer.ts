/**
 * In-memory ring buffer of recent MCP tool invocations.
 *
 * The pino logger is the authoritative audit trail; this buffer is a
 * lightweight side-store for the **Connect tab's "Recent integration
 * traffic"** strip in the UI. It exists for two reasons:
 *
 *   1. **Demo signal.** When a user clicks a snippet into a notebook
 *      and runs it, the Connect tab pulses with the resulting tool
 *      calls. That's the most concise way to make the "yes, this
 *      works" point in a meeting.
 *   2. **Operator triage.** "Is anyone actually using this MCP
 *      surface?" — a 24-hour count + the last few entries gives a
 *      yes/no without grepping pino output.
 *
 * Design rules:
 *   - **In-memory only.** Restarts wipe the buffer. The pino trail
 *     remains the persistent record. Sizing the buffer larger than
 *     it needs to be would invite people to depend on it for
 *     compliance.
 *   - **Per-workspace partitioning.** A workspace's traffic is its
 *     own; we never expose cross-workspace data through this buffer.
 *   - **Capped by entry count AND age.** Both knobs so an idle
 *     workspace doesn't accumulate years-old entries that confuse a
 *     "last hour" UI, and a chatty workspace doesn't OOM the runtime.
 *   - **No payload bodies.** We record `toolName` + `outcome` +
 *     `subject` + timestamps. Tool argument payloads are deliberately
 *     omitted (could contain user prompts, KB ids, etc. — same
 *     reasoning as the audit envelope itself).
 *   - **Lock-free.** Single-threaded JS, so the ring is just a
 *     `Map<workspaceId, Entry[]>` mutated in place. No atomic
 *     operations needed.
 */

import type { AuditAction, AuditOutcome } from "./audit.js";

/**
 * One row of the ring. The shape is the projection of the audit
 * envelope the UI strip renders — keep it as flat as possible so the
 * route layer can hand it back without further massaging.
 */
export interface McpTrafficEntry {
	/** ISO timestamp of when the tool call resolved (success or failure). */
	readonly at: string;
	/** Stable MCP tool name — `search_kb`, `list_documents`, … */
	readonly toolName: string;
	readonly outcome: AuditOutcome;
	/**
	 * Auth subject type, when known. Distinguishes API-key calls from
	 * OIDC users and anonymous (dev-mode) calls in the UI strip.
	 */
	readonly subjectType:
		| "apiKey"
		| "oidc"
		| "bootstrap"
		| "anonymous"
		| "system";
	/** API-key label / OIDC `email` / null. */
	readonly subjectLabel: string | null;
	/** Failure reason from the tool handler, when outcome is failure. */
	readonly reason: string | null;
}

export interface RecentOptions {
	/** Cap the response size. Defaults to {@link DEFAULT_RECENT_LIMIT}. */
	readonly limit?: number;
	/**
	 * Only return entries newer than this. Lets the UI render a "last
	 * hour" / "last 24h" pulse without server-side cleanup. Absent =
	 * return everything in the buffer (subject to `limit`).
	 */
	readonly sinceMs?: number;
}

export interface RecordInput {
	readonly workspaceId: string;
	readonly action: AuditAction;
	readonly outcome: AuditOutcome;
	readonly toolName: string;
	readonly subjectType: McpTrafficEntry["subjectType"];
	readonly subjectLabel: string | null;
	readonly reason: string | null;
}

/**
 * Default ring size. ~24h of moderate use at one call per few minutes
 * — enough for the demo signal, small enough that the runtime
 * shouldn't notice. Tunable via {@link McpTrafficBuffer} construction.
 */
export const DEFAULT_RING_SIZE = 256;
export const DEFAULT_RECENT_LIMIT = 50;
/**
 * Older entries are evicted on read (lazy cleanup). 24h matches the
 * UI's "last 24h" framing.
 */
export const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

export class McpTrafficBuffer {
	private readonly rings = new Map<string, McpTrafficEntry[]>();
	private readonly maxPerWorkspace: number;
	private readonly retentionMs: number;
	private readonly now: () => Date;

	constructor(
		opts: {
			readonly maxPerWorkspace?: number;
			readonly retentionMs?: number;
			/** Clock injection for tests. */
			readonly now?: () => Date;
		} = {},
	) {
		this.maxPerWorkspace = opts.maxPerWorkspace ?? DEFAULT_RING_SIZE;
		this.retentionMs = opts.retentionMs ?? DEFAULT_RETENTION_MS;
		this.now = opts.now ?? (() => new Date());
	}

	/**
	 * Record one tool invocation. Filters at the call site keep
	 * non-MCP audit events out — see the `audit()` integration in
	 * `lib/audit.ts`.
	 */
	record(input: RecordInput): void {
		const entry: McpTrafficEntry = {
			at: this.now().toISOString(),
			toolName: input.toolName,
			outcome: input.outcome,
			subjectType: input.subjectType,
			subjectLabel: input.subjectLabel,
			reason: input.reason,
		};
		const bucket = this.rings.get(input.workspaceId) ?? [];
		bucket.push(entry);
		// Trim from the front when over the cap so the newest stay.
		while (bucket.length > this.maxPerWorkspace) bucket.shift();
		this.rings.set(input.workspaceId, bucket);
	}

	/**
	 * Recent entries for a workspace, newest first. Lazy-evicts
	 * anything older than the retention window so callers don't have
	 * to think about cleanup.
	 */
	recent(
		workspaceId: string,
		opts: RecentOptions = {},
	): readonly McpTrafficEntry[] {
		const bucket = this.rings.get(workspaceId);
		if (!bucket || bucket.length === 0) return [];
		const cutoffMs = this.now().getTime() - this.retentionMs;
		// Drop expired entries from the front of the ring (the array
		// is append-ordered, so a single forward sweep finds the
		// cutoff point in O(expired count), not the full ring).
		while (bucket.length > 0) {
			const head = bucket[0];
			if (!head) break;
			if (Date.parse(head.at) >= cutoffMs) break;
			bucket.shift();
		}
		const sinceCutoffMs = opts.sinceMs ?? null;
		const limit = opts.limit ?? DEFAULT_RECENT_LIMIT;
		// Walk back-to-front (newest first), apply since filter, cap
		// by limit. Cheaper than building a sorted copy when the
		// caller only wants the head.
		const out: McpTrafficEntry[] = [];
		for (let i = bucket.length - 1; i >= 0 && out.length < limit; i -= 1) {
			const entry = bucket[i];
			if (!entry) continue;
			if (sinceCutoffMs !== null && Date.parse(entry.at) < sinceCutoffMs) {
				break;
			}
			out.push(entry);
		}
		return out;
	}

	/**
	 * Aggregate counts across the retention window. Drives the "1,204
	 * calls · 0 errors in the last 24h" summary text in the UI strip.
	 */
	summary(workspaceId: string): {
		readonly total: number;
		readonly successes: number;
		readonly failures: number;
	} {
		const entries = this.recent(workspaceId, {
			limit: Number.POSITIVE_INFINITY,
		});
		let successes = 0;
		let failures = 0;
		for (const entry of entries) {
			if (entry.outcome === "success") successes += 1;
			else failures += 1;
		}
		return { total: entries.length, successes, failures };
	}

	/** Test helper — wipe everything. Never called in production. */
	reset(): void {
		this.rings.clear();
	}
}

/**
 * Process-wide singleton. Hooked from `lib/audit.ts` so every
 * `audit(c, { action: "mcp.invoke", ... })` call automatically lands
 * in the buffer without route handlers having to remember.
 *
 * Exposed as a top-level binding (rather than passed through deps)
 * because the audit module is itself a top-level utility — threading
 * yet another singleton through every route would dwarf the benefit.
 * The trade-off is that tests have to call `.reset()` between cases.
 */
export const mcpTrafficBuffer = new McpTrafficBuffer();
