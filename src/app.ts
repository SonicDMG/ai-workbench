import { Hono } from 'hono';
import type { WorkspaceRegistry } from './workspaces/registry.js';
import { operationalRoutes } from './routes/operational.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { requestId } from './lib/request-id.js';
import { errorEnvelope } from './lib/errors.js';
import { ApiError } from './lib/errors.js';
import type { AppEnv } from './lib/types.js';

export interface AppOptions {
  registry: WorkspaceRegistry;
  requestIdHeader?: string;
}

export function createApp(opts: AppOptions) {
  const app = new Hono<AppEnv>();

  app.use('*', requestId(opts.requestIdHeader));

  app.route('/', operationalRoutes(opts.registry));
  app.route('/v1/workspaces', workspaceRoutes(opts.registry));

  app.notFound((c) =>
    c.json(
      errorEnvelope(c, 'not_found', `Route ${c.req.method} ${c.req.path} not found`),
      404,
    ),
  );

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(errorEnvelope(c, err.code, err.message), err.status);
    }
    return c.json(
      errorEnvelope(c, 'internal_error', err.message || 'internal server error'),
      500,
    );
  });

  return app;
}
