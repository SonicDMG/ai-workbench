/**
 * Statically-composed plugin registry — see
 * [docs/route-plugins.md](../../../../docs/route-plugins.md).
 *
 * The registry is built once during startup in
 * [`root.ts`](../root.ts) and passed to {@link createApp}. Tests build
 * their own registry with the subset of plugins they need.
 *
 * Rules:
 *   - {@link RoutePluginRegistry.register} throws on duplicate `id` so
 *     a misconfigured registry fails fast at startup, never at
 *     request time.
 *   - {@link RoutePluginRegistry.list} returns plugins in
 *     registration order, which is also the mount order. Hono's route
 *     precedence is first-write-wins for overlapping paths.
 */

import type { RoutePlugin } from "./types.js";

const PLUGIN_ID_RE = /^[a-z][a-z0-9_]*$/;

/** Thrown when {@link RoutePluginRegistry.register} rejects a plugin. */
export class RoutePluginRegistrationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RoutePluginRegistrationError";
	}
}

export class RoutePluginRegistry {
	private readonly plugins: RoutePlugin[] = [];
	private readonly byId = new Map<string, RoutePlugin>();

	/**
	 * Register a plugin. Throws on duplicate `id`, malformed `id`, or
	 * malformed `mountPath`.
	 *
	 * Returns `this` so callers can chain registrations.
	 */
	register(plugin: RoutePlugin): this {
		if (!PLUGIN_ID_RE.test(plugin.id)) {
			throw new RoutePluginRegistrationError(
				`route plugin id must match ${PLUGIN_ID_RE} — got "${plugin.id}"`,
			);
		}
		if (!plugin.mountPath.startsWith("/")) {
			throw new RoutePluginRegistrationError(
				`route plugin "${plugin.id}" mountPath must start with "/" — got "${plugin.mountPath}"`,
			);
		}
		if (this.byId.has(plugin.id)) {
			throw new RoutePluginRegistrationError(
				`route plugin id "${plugin.id}" is already registered`,
			);
		}
		this.byId.set(plugin.id, plugin);
		this.plugins.push(plugin);
		return this;
	}

	/** Snapshot of registered plugins in registration order. */
	list(): readonly RoutePlugin[] {
		return [...this.plugins];
	}

	/** Lookup by id; returns `undefined` if not registered. */
	get(id: string): RoutePlugin | undefined {
		return this.byId.get(id);
	}

	/** How many plugins are currently registered. */
	get size(): number {
		return this.plugins.length;
	}
}
