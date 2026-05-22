/**
 * Cheap, side-effect-free probes used by the deep-health endpoint
 * (`GET /health/details`) and the `aiw doctor` CLI.
 *
 * The probes deliberately do NOT mutate state, do NOT spawn workers,
 * and bound their own wall-clock so a hung dependency can't stall the
 * caller. The contract every probe returns:
 *
 *   { status: "ok" | "degraded" | "down", detail: string, durationMs: number }
 *
 * `degraded` is reserved for "responded but with an error envelope or
 * unexpected shape"; `down` is "didn't respond inside the timeout, or
 * threw at the transport layer". This split lets a dashboard tell
 * the difference between "Astra is up but the keyspace doesn't exist"
 * and "Astra is unreachable."
 */
import type { ChatService } from "../chat/types.js";
import type { ControlPlaneStore } from "../control-plane/store.js";

export type ProbeStatus = "ok" | "degraded" | "down";

export interface ProbeResult {
	readonly status: ProbeStatus;
	readonly detail: string;
	readonly durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 3_000;

async function timed<T>(
	timeoutMs: number,
	body: (signal: AbortSignal) => Promise<T>,
): Promise<{
	value?: T;
	timedOut: boolean;
	durationMs: number;
	error?: unknown;
}> {
	const controller = new AbortController();
	const start = Date.now();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const value = await body(controller.signal);
		return { value, timedOut: false, durationMs: Date.now() - start };
	} catch (error: unknown) {
		const timedOut = controller.signal.aborted;
		return { error, timedOut, durationMs: Date.now() - start };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Round-trips a single `listWorkspaces()` call. Every control-plane
 * backend implements this (memory / file / astra); the probe doubles
 * as a liveness check for the underlying driver (file IO, Astra
 * Data-API tables, etc.).
 */
export async function probeControlPlane(
	store: ControlPlaneStore,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ProbeResult> {
	const r = await timed(timeoutMs, async () => store.listWorkspaces());
	if (r.timedOut) {
		return {
			status: "down",
			detail: `listWorkspaces() timed out after ${timeoutMs}ms`,
			durationMs: r.durationMs,
		};
	}
	if (r.error) {
		return {
			status: "down",
			detail: r.error instanceof Error ? r.error.message : String(r.error),
			durationMs: r.durationMs,
		};
	}
	const count = r.value?.length ?? 0;
	return {
		status: "ok",
		detail: `${count} workspace(s)`,
		durationMs: r.durationMs,
	};
}

/**
 * Provider-specific cheap probe. Each chat service exposes its own
 * `ping()` (added alongside this module) so the probe stays inside
 * the provider boundary — no provider-conditional logic out here.
 */
export async function probeChatProvider(
	service: ChatService | null,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ProbeResult> {
	if (!service) {
		return {
			status: "down",
			detail: "no chat service configured",
			durationMs: 0,
		};
	}
	if (!service.ping) {
		return {
			status: "ok",
			detail: `${service.providerId} (no provider ping; configured)`,
			durationMs: 0,
		};
	}
	const r = await timed(timeoutMs, async (signal) =>
		service.ping?.({ signal }),
	);
	if (r.timedOut) {
		return {
			status: "down",
			detail: `${service.providerId} ping timed out after ${timeoutMs}ms`,
			durationMs: r.durationMs,
		};
	}
	if (r.error) {
		return {
			status: "degraded",
			detail: `${service.providerId}: ${r.error instanceof Error ? r.error.message : String(r.error)}`,
			durationMs: r.durationMs,
		};
	}
	return {
		status: "ok",
		detail: `${service.providerId} (${service.modelId})`,
		durationMs: r.durationMs,
	};
}
