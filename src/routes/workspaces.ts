import { Hono } from 'hono';
import type { WorkspaceRegistry } from '../workspaces/registry.js';
import type { AppEnv } from '../lib/types.js';
import { errorEnvelope } from '../lib/errors.js';
import { redact } from '../lib/redact.js';

export function workspaceRoutes(registry: WorkspaceRegistry) {
  const app = new Hono<AppEnv>();

  app.get('/', (c) =>
    c.json({
      data: registry.list().map((w) => ({
        id: w.config.id,
        driver: w.config.driver,
        description: w.config.description,
      })),
    }),
  );

  app.get('/:workspaceId', (c) => {
    const id = c.req.param('workspaceId');
    const ws = registry.get(id);
    if (!ws) {
      return c.json(
        errorEnvelope(c, 'workspace_not_found', `Workspace '${id}' is not defined`),
        404,
      );
    }
    return c.json({ data: redact(ws.config) });
  });

  return app;
}
