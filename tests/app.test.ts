import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import { WorkspaceRegistry } from '../src/workspaces/registry.js';
import { ConfigSchema } from '../src/config/schema.js';

// Tests fetch JSON and assert on properties; cast to `any` for ergonomic access.
async function json(res: Response): Promise<any> {
  return (await res.json()) as any;
}

function mockConfig() {
  return ConfigSchema.parse({
    version: 1,
    workspaces: [
      {
        id: 'mock',
        driver: 'mock',
        description: 'test mock',
        vectorStores: [{ id: 'v1', collection: 'c', dimensions: 128 }],
        catalogs: [{ id: 'cat1', vectorStore: 'v1' }],
      },
    ],
  });
}

function astraConfig() {
  return ConfigSchema.parse({
    version: 1,
    workspaces: [
      {
        id: 'prod',
        driver: 'astra',
        description: 'prod astra',
        astra: {
          endpoint: 'https://example.apps.astra.datastax.com',
          token: 'super-secret-token',
          keyspace: 'default_keyspace',
        },
        auth: { kind: 'bearer', tokens: ['wb-tok'] },
        vectorStores: [{ id: 'v1', collection: 'c', dimensions: 1536 }],
        catalogs: [{ id: 'cat1', vectorStore: 'v1' }],
      },
    ],
  });
}

function makeApp(config = mockConfig()) {
  return createApp({ registry: new WorkspaceRegistry(config) });
}

describe('operational routes', () => {
  test('GET / returns service banner', async () => {
    const res = await makeApp().request('/');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ name: 'ai-workbench', docs: '/docs' });
    expect(body.version).toBeDefined();
    expect(body.commit).toBeDefined();
  });

  test('GET /healthz returns ok', async () => {
    const res = await makeApp().request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('GET /readyz returns ready when all workspaces ready', async () => {
    const res = await makeApp().request('/readyz');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'ready',
      workspaces: ['mock'],
    });
  });

  test('GET /readyz returns 503 when a workspace is unready', async () => {
    const cfg = ConfigSchema.parse({
      version: 1,
      workspaces: [
        {
          id: 'prod',
          driver: 'astra',
          astra: {
            endpoint: 'https://x.apps.astra.datastax.com',
            token: 'ok',
          },
          vectorStores: [],
          catalogs: [],
        },
      ],
    });
    const registry = new WorkspaceRegistry(cfg);
    // Force the workspace into unready for the test.
    (registry as unknown as { workspaces: Map<string, unknown> }).workspaces =
      new Map([
        [
          'prod',
          {
            config: cfg.workspaces[0],
            status: 'unready',
            error: 'astra credentials missing',
          },
        ],
      ]);
    const app = createApp({ registry });
    const res = await app.request('/readyz');
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body.error.code).toBe('workspace_unready');
  });

  test('GET /version returns build metadata', async () => {
    const res = await makeApp().request('/version');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ node: process.version });
    expect(body.version).toBeDefined();
    expect(body.buildTime).toBeDefined();
  });

  test('responses carry X-Request-Id', async () => {
    const res = await makeApp().request('/healthz');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  test('echoes client-provided request id', async () => {
    const res = await makeApp().request('/healthz', {
      headers: { 'X-Request-Id': 'abc-123' },
    });
    expect(res.headers.get('X-Request-Id')).toBe('abc-123');
  });
});

describe('workspace routes', () => {
  test('GET /v1/workspaces lists workspaces', async () => {
    const res = await makeApp().request('/v1/workspaces');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: 'mock',
      driver: 'mock',
      description: 'test mock',
    });
  });

  test('GET /v1/workspaces/:id returns details', async () => {
    const res = await makeApp().request('/v1/workspaces/mock');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.id).toBe('mock');
    expect(body.data.driver).toBe('mock');
  });

  test('GET /v1/workspaces/:id returns 404 for unknown', async () => {
    const res = await makeApp().request('/v1/workspaces/nope');
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.error.code).toBe('workspace_not_found');
    expect(body.error.requestId).toBeTruthy();
  });

  test('redacts astra token', async () => {
    const res = await makeApp(astraConfig()).request('/v1/workspaces/prod');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.astra.token).toBe('****');
    expect(body.data.astra.endpoint).toBe(
      'https://example.apps.astra.datastax.com',
    );
  });

  test('redacts bearer auth tokens', async () => {
    const res = await makeApp(astraConfig()).request('/v1/workspaces/prod');
    const body = await json(res);
    expect(body.data.auth.tokens).toEqual(['****']);
  });
});

describe('error handling', () => {
  test('unknown routes return 404 envelope', async () => {
    const res = await makeApp().request('/no-such-path');
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.error.code).toBe('not_found');
  });
});
