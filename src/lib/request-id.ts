import type { MiddlewareHandler } from 'hono';
import { ulid } from 'ulid';
import type { AppEnv } from './types.js';

export const DEFAULT_HEADER = 'X-Request-Id';

export function requestId(headerName: string = DEFAULT_HEADER): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incoming = c.req.header(headerName);
    const id = incoming && incoming.length > 0 ? incoming : ulid();
    c.set('requestId', id);
    c.header(headerName, id);
    await next();
  };
}
