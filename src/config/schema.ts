import { z } from 'zod';

const Id = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/, 'must match /^[a-z][a-z0-9-]{0,63}$/');

const Url = z.string().url();

const VectorStoreSchema = z.object({
  id: Id,
  collection: z.string().min(1),
  dimensions: z.number().int().positive(),
  metric: z.enum(['cosine', 'dot', 'euclidean']).default('cosine'),
});

const CatalogSchema = z.object({
  id: Id,
  description: z.string().optional(),
  vectorStore: z.string().min(1),
  chunker: z.string().optional(),
  embedder: z.string().optional(),
});

const AuthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('bearer'),
    tokens: z.array(z.string().min(1)).min(1),
  }),
]);

const ServicesRef = z
  .object({
    chunking: z.object({ url: Url }).optional(),
    embedding: z.object({ url: Url }).optional(),
  })
  .optional();

const WorkspaceBase = z.object({
  id: Id,
  description: z.string().optional(),
  auth: AuthSchema.optional(),
  vectorStores: z.array(VectorStoreSchema).default([]),
  catalogs: z.array(CatalogSchema).default([]),
  services: ServicesRef,
});

const AstraConfig = z.object({
  endpoint: Url,
  token: z.string().min(1),
  keyspace: z.string().optional(),
});

const MockConfig = z
  .object({
    seed: z.string().optional(),
  })
  .optional();

const WorkspaceSchema = z.discriminatedUnion('driver', [
  WorkspaceBase.extend({
    driver: z.literal('astra'),
    astra: AstraConfig,
  }),
  WorkspaceBase.extend({
    driver: z.literal('mock'),
    mock: MockConfig,
  }),
]);

const RuntimeSchema = z
  .object({
    port: z.number().int().min(1).max(65535).default(8080),
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
    requestIdHeader: z.string().min(1).default('X-Request-Id'),
  })
  .default({
    port: 8080,
    logLevel: 'info',
    requestIdHeader: 'X-Request-Id',
  });

export const ConfigSchema = z
  .object({
    version: z.literal(1),
    runtime: RuntimeSchema,
    services: ServicesRef,
    workspaces: z.array(WorkspaceSchema).min(1),
  })
  .superRefine((cfg, ctx) => {
    const wsIds = new Set<string>();
    cfg.workspaces.forEach((ws, i) => {
      if (wsIds.has(ws.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['workspaces', i, 'id'],
          message: `duplicate workspace id '${ws.id}'`,
        });
      }
      wsIds.add(ws.id);

      const vsIds = new Set<string>();
      ws.vectorStores.forEach((vs, j) => {
        if (vsIds.has(vs.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['workspaces', i, 'vectorStores', j, 'id'],
            message: `duplicate vectorStore id '${vs.id}' in workspace '${ws.id}'`,
          });
        }
        vsIds.add(vs.id);
      });

      const catIds = new Set<string>();
      const vsToCatalog = new Map<string, string>();
      ws.catalogs.forEach((cat, j) => {
        if (catIds.has(cat.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['workspaces', i, 'catalogs', j, 'id'],
            message: `duplicate catalog id '${cat.id}' in workspace '${ws.id}'`,
          });
        }
        catIds.add(cat.id);

        if (!vsIds.has(cat.vectorStore)) {
          ctx.addIssue({
            code: 'custom',
            path: ['workspaces', i, 'catalogs', j, 'vectorStore'],
            message: `catalog '${cat.id}' references unknown vectorStore '${cat.vectorStore}'`,
          });
          return;
        }
        const existing = vsToCatalog.get(cat.vectorStore);
        if (existing) {
          ctx.addIssue({
            code: 'custom',
            path: ['workspaces', i, 'catalogs', j, 'vectorStore'],
            message: `vectorStore '${cat.vectorStore}' already bound to catalog '${existing}' (strict 1:1 binding)`,
          });
          return;
        }
        vsToCatalog.set(cat.vectorStore, cat.id);
      });
    });
  });

export type Config = z.infer<typeof ConfigSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type VectorStore = z.infer<typeof VectorStoreSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;
