const PATTERN = /\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g;

export class MissingEnvError extends Error {
  constructor(
    public readonly variable: string,
    public readonly path: string,
  ) {
    super(`Environment variable \${${variable}} is required at ${path} but not set`);
    this.name = 'MissingEnvError';
  }
}

type Env = Record<string, string | undefined>;

export function interpolate(value: unknown, env: Env = process.env, path = '$'): unknown {
  if (typeof value === 'string') {
    return interpolateString(value, env, path);
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => interpolate(item, env, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolate(v, env, `${path}.${k}`);
    }
    return out;
  }
  return value;
}

function interpolateString(s: string, env: Env, path: string): string {
  return s.replace(PATTERN, (_match, name: string, def?: string) => {
    const val = env[name];
    if (val !== undefined) return val;
    if (def !== undefined) return def;
    throw new MissingEnvError(name, path);
  });
}
