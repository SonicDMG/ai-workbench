import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig, resolveConfigPath } from './config/loader.js';
import { WorkspaceRegistry } from './workspaces/registry.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  const configPath = resolveConfigPath();
  logger.info({ configPath }, 'loading config');

  const config = await loadConfig(configPath);
  const registry = new WorkspaceRegistry(config);

  const unready = registry.unready();
  if (unready.length > 0) {
    logger.warn(
      { unready: unready.map((w) => ({ id: w.config.id, error: w.error })) },
      'some workspaces failed to resolve',
    );
  }

  const app = createApp({
    registry,
    requestIdHeader: config.runtime.requestIdHeader,
  });

  const port = config.runtime.port;
  serve({ fetch: app.fetch, port }, (info) => {
    logger.info(
      { port: info.port, workspaces: registry.ids() },
      'ai-workbench listening',
    );
  });

  const shutdown = (signal: string) => () => {
    logger.info({ signal }, 'shutting down');
    process.exit(0);
  };
  process.on('SIGINT', shutdown('SIGINT'));
  process.on('SIGTERM', shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.error({ err }, 'startup failed');
  process.exit(1);
});
