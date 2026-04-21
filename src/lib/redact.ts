const SENSITIVE_KEY = /token|apikey|api_key|password|secret/i;
const MASK = '****';

export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = maskValue(v);
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

function maskValue(value: unknown): unknown {
  if (typeof value === 'string') return MASK;
  if (Array.isArray(value)) return value.map(() => MASK);
  if (value && typeof value === 'object') return MASK;
  return value;
}
