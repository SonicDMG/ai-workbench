import { Hono } from 'hono';
import type { WorkspaceRegistry } from '../workspaces/registry.js';
import type { AppEnv } from '../lib/types.js';
import { errorEnvelope } from '../lib/errors.js';
import { VERSION, COMMIT, BUILD_TIME } from '../version.js';

export function operationalRoutes(registry: WorkspaceRegistry) {
  const app = new Hono<AppEnv>();

  app.get('/', (c) =>
    c.json({
      name: 'ai-workbench',
      version: VERSION,
      commit: COMMIT,
      docs: '/docs',
    }),
  );

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.get('/readyz', (c) => {
    if (registry.allReady()) {
      return c.json({
        status: 'ready',
        workspaces: registry.ids(),
      });
    }
    const [first] = registry.unready();
    const id = first?.config.id ?? 'unknown';
    const reason = first?.error ?? 'unknown error';
    return c.json(
      errorEnvelope(
        c,
        'workspace_unready',
        `Workspace '${id}' failed to initialize: ${reason}`,
      ),
      503,
    );
  });

  app.get('/version', (c) =>
    c.json({
      version: VERSION,
      commit: COMMIT,
      buildTime: BUILD_TIME,
      node: process.version,
    }),
  );

  return app;
}
