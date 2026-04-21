import type { Config, Workspace } from "../config/schema.js";

export type WorkspaceStatus = "ready" | "unready";

export interface ResolvedWorkspace {
	readonly config: Workspace;
	readonly status: WorkspaceStatus;
	readonly error?: string;
}

/**
 * In-process registry of workspaces resolved from config.
 * Phase 0: driver wiring is stubbed — only config presence is validated.
 *   - `mock` → always ready
 *   - `astra` → ready if endpoint + token resolved (credentials not dialed)
 * Phase 1+ will replace the stub with actual driver initialization.
 */
export class WorkspaceRegistry {
	private readonly workspaces: ReadonlyMap<string, ResolvedWorkspace>;

	constructor(config: Config) {
		const entries = config.workspaces.map(
			(ws) => [ws.id, resolveWorkspace(ws)] as const,
		);
		this.workspaces = new Map(entries);
	}

	list(): readonly ResolvedWorkspace[] {
		return Array.from(this.workspaces.values());
	}

	get(id: string): ResolvedWorkspace | undefined {
		return this.workspaces.get(id);
	}

	ids(): readonly string[] {
		return Array.from(this.workspaces.keys());
	}

	allReady(): boolean {
		return this.list().every((w) => w.status === "ready");
	}

	unready(): readonly ResolvedWorkspace[] {
		return this.list().filter((w) => w.status !== "ready");
	}
}

function resolveWorkspace(ws: Workspace): ResolvedWorkspace {
	if (ws.driver === "mock") {
		return { config: ws, status: "ready" };
	}
	// ws.driver === 'astra'
	if (!ws.astra.token || !ws.astra.endpoint) {
		return {
			config: ws,
			status: "unready",
			error: "astra credentials missing",
		};
	}
	return { config: ws, status: "ready" };
}
