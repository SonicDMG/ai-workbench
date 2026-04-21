function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export const VERSION = nonEmpty(process.env.APP_VERSION) ?? '0.0.0';
export const COMMIT = nonEmpty(process.env.APP_COMMIT) ?? 'unknown';
export const BUILD_TIME = nonEmpty(process.env.APP_BUILD_TIME) ?? new Date().toISOString();
