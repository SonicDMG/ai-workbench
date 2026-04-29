# Route plugins — design note

Status snapshot:

| Slice | Status |
|---|---|
| `RoutePlugin` interface + registry scaffold | ✅ shipped |
| Migrate one existing route group (api-keys) onto the registry | 📋 next |
| Migrate the remaining `/api/v1/*` route groups | 📋 follow-up |
| External plugin loading from `workbench.yaml` | 🔭 future |

## The problem

Today, adding a new resource under `/api/v1/*` is an N+1 edit across
the runtime: the route module is new, but it has to be wired into
[`app.ts`](../runtimes/typescript/src/app.ts) by hand, every other
green box has to mirror the change, and the web client has to grow a
matching hook + page. The first two costs land on the cross-runtime
contract; this note addresses only the **in-runtime** half — making
the TypeScript runtime's `app.ts` a host that mounts a list of route
plugins instead of importing each route file by name.

The failure mode this fixes: `app.ts` is the single chokepoint for
every new route. Touching it for every feature blurs git blame,
inflates code review for unrelated changes, and pressures contributors
to skip security-relevant middleware ("just one more `app.use`") to
keep diffs small.

## Goals

- A new resource module **never edits `app.ts`**. It exports a
  `RoutePlugin` value that the registry mounts.
- Existing middleware (auth, rate limiting, body limits, audit, error
  envelope) continues to apply uniformly. Plugins do not get to opt
  out.
- Registration is statically composed at startup — not dynamic. We
  want type-safe wiring and reproducible builds, not a mutable
  runtime registry.
- The conformance harness keeps working unchanged. Plugins serve the
  same `/api/v1/*` paths; the cross-runtime contract is unaffected.

## Non-goals

- **External plugin loading from `workbench.yaml`** — out of scope
  for this slice. The interface should not preclude it, but the
  initial registry only accepts in-tree plugins so we don't ship a
  third-party code-execution surface by accident.
- **Cross-runtime plugin model.** This is a TypeScript-runtime
  refactor. Python and Java green boxes choose their own composition
  story; the only contract that crosses runtimes is the HTTP one.
- **Per-tenant plugin sets.** Every plugin runs for every workspace
  that hits the runtime. Tenant-specific feature flags live in
  workspace records, not in the registry.

## The interface

```ts
// runtimes/typescript/src/plugins/types.ts
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
  /** Stable id, snake_case. Used in logs and duplicate-detection. */
  readonly id: string;
  /** Mount path under the app root. */
  readonly mountPath: string;
  /** Build a sub-app exposing the plugin's routes. */
  build(ctx: RoutePluginContext): OpenAPIHono<AppEnv>;
}
```

A plugin is data — not a class hierarchy. The `build` function gets a
narrowed view of the runtime's dependencies and returns a Hono
sub-app, which `app.ts` mounts at `mountPath`.

## The registry

```ts
// runtimes/typescript/src/plugins/registry.ts
export class RoutePluginRegistry {
  register(plugin: RoutePlugin): this;
  list(): readonly RoutePlugin[];
}
```

Rules:

- `register` throws on duplicate `id`. Fail fast at startup, never at
  request time.
- `list` returns plugins in the order they were registered. The
  registration order is also the mount order, which matters for
  Hono's route precedence.
- The registry is built once during startup in `root.ts` and passed
  to `createApp`. Tests build their own registry with the subset of
  plugins they need.

## Integration with `app.ts`

`createApp` keeps wiring the cross-cutting concerns it owns today
(request-id, security headers, rate limiting, body limits, auth
middleware, error handler). After those, it walks the registry and
calls `app.route(plugin.mountPath, plugin.build(ctx))` for each
plugin. The OpenAPI generation step is unchanged; the sub-apps
contribute their routes to the same `OpenAPIHono` instance.

## Migration plan

1. **This PR (scaffold).** Land `plugins/types.ts`,
   `plugins/registry.ts`, tests for the registry. No existing routes
   move yet; `app.ts` is untouched. New code can opt in.
2. **First migration (api-keys).** Rewrite `apiKeyRoutes(...)` to
   export a `RoutePlugin` and register it from `root.ts`. Replace the
   matching `app.route(...)` line in `app.ts` with the registry walk
   for *just this plugin*. Conformance + tests must stay green.
3. **Bulk migration.** Move every other `/api/v1/*` route group onto
   the registry. After this, `app.ts` no longer mentions individual
   route modules — only the host loop.
4. **Future: external plugins.** Add a YAML-loaded plugin list with
   an explicit allowlist of trusted paths. Out of scope here.

## Open questions

- **Sub-app middleware.** Some routes today inject their own
  middleware (`authMiddleware` over `/api/v1/workspaces/*`). Should
  those middleware be expressed as separate "middleware plugins"
  registered in the same registry, or stay hand-wired in `app.ts`?
  Initial answer: keep them hand-wired. The middleware set is small
  and security-critical; the plugin system targets the long tail of
  resource routes, not the security perimeter.
- **OpenAPI tag conventions.** Plugins should default their OpenAPI
  tag to their `id`. We don't enforce this in the interface; route
  modules continue to set tags per route. Worth revisiting once we
  have more than one resource family per plugin.
- **Hono context typing.** All plugins share the runtime's `AppEnv`
  context. If a future plugin needs to set its own context variables,
  we'll need a typed extension mechanism — not a problem yet.
