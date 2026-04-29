/**
 * Route-plugin contract — see [docs/route-plugins.md](../../../../docs/route-plugins.md).
 *
 * A {@link RoutePlugin} is a piece of in-tree code that contributes
 * routes to the runtime without editing
 * [`app.ts`](../app.ts) directly. Plugins are data: an `id`, a
 * `mountPath`, and a `build(ctx)` function that returns a Hono
 * sub-app. `app.ts` walks the registry after wiring the cross-cutting
 * middleware (auth, rate limiting, body limits, audit) and mounts each
 * plugin at its declared path.
 *
 * The interface is intentionally conservative for the first slice:
 *   - No middleware ownership — plugins cannot opt out of the
 *     security perimeter set up in `app.ts`.
 *   - No dynamic loading — the registry only accepts in-tree plugins.
 *   - No tenant-specific filtering — every plugin runs for every
 *     request that matches its mount path.
 */

import type { OpenAPIHono } from "@hono/zod-openapi";
import type { ChatService } from "../chat/types.js";
import type { ChatConfig } from "../config/schema.js";
import type { ControlPlaneStore } from "../control-plane/store.js";
import type { VectorStoreDriverRegistry } from "../drivers/registry.js";
import type { EmbedderFactory } from "../embeddings/factory.js";
import type { JobStore } from "../jobs/store.js";
import type { AppEnv } from "../lib/types.js";
import type { SecretResolver } from "../secrets/provider.js";

/**
 * Narrowed view of {@link AppOptions} that plugins receive. Adding a
 * field here is a breaking change for every plugin — keep it small.
 */
export interface RoutePluginContext {
	readonly store: ControlPlaneStore;
	readonly drivers: VectorStoreDriverRegistry;
	readonly embedders: EmbedderFactory;
	readonly secrets: SecretResolver;
	readonly jobs: JobStore;
	readonly chatService: ChatService | null;
	readonly chatConfig: ChatConfig | null;
	readonly replicaId: string;
}

export interface RoutePlugin {
	/**
	 * Stable identifier — snake_case, lowercase, ASCII. Used for
	 * duplicate detection in the registry and for log lines that
	 * attribute a request to a plugin. Renaming is a breaking change.
	 */
	readonly id: string;
	/**
	 * Path under the app root where the sub-app gets mounted, e.g.
	 * `"/api/v1/workspaces"`. Must start with `/`. Multiple plugins may
	 * share a mount path — they're composed in registration order.
	 */
	readonly mountPath: string;
	/**
	 * Build a fresh sub-app for this plugin. Called once at startup
	 * during {@link createApp}. Plugins must not mutate `ctx`.
	 */
	build(ctx: RoutePluginContext): OpenAPIHono<AppEnv>;
}
