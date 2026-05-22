/**
 * HTTP client used by every CLI command.
 *
 * Wraps the global `fetch` so commands stay terse: a single
 * {@link request} call dispatches an authed JSON request, decodes the
 * Workbench's error envelope on non-2xx, and returns a parsed body.
 * Streaming responses (file upload, chat) use {@link rawRequest}
 * instead and inspect `Response` directly.
 *
 * Behavioural guarantees:
 *   - Each call has an `AbortController` timeout. Defaults to 10s and
 *     overrideable with `AIW_REQUEST_TIMEOUT_MS`.
 *   - Network errors (DNS, ECONNREFUSED, timeouts) get retried once
 *     with 250ms backoff. 4xx/5xx HTTP responses never retry — the
 *     server already made up its mind. Override with
 *     `AIW_REQUEST_RETRIES` (set to 0 to disable).
 *   - The error envelope's `hint` and `docs` fields ride along on
 *     {@link HttpError} so {@link ../output.fail} can print them.
 */
import { z } from "zod";
import type { Profile } from "./config.js";

const ErrorEnvelopeSchema = z.object({
	error: z
		.object({
			code: z.string().optional(),
			message: z.string().optional(),
			hint: z.string().optional(),
			docs: z.string().optional(),
			requestId: z.string().optional(),
		})
		.passthrough(),
});

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 1;
const RETRY_BACKOFF_MS = 250;

export interface RequestOptions {
	readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	readonly query?: Record<string, string | number | boolean | undefined>;
	readonly body?: unknown;
	readonly headers?: Record<string, string>;
	readonly signal?: AbortSignal;
	/** Per-call override; otherwise reads `AIW_REQUEST_TIMEOUT_MS` or 10000. */
	readonly timeoutMs?: number;
	/** Per-call override; otherwise reads `AIW_REQUEST_RETRIES` or 1. */
	readonly retries?: number;
}

export interface RequestContext {
	readonly profile: Profile;
	readonly env?: NodeJS.ProcessEnv;
}

export interface ApiError {
	readonly status: number;
	readonly code: string;
	readonly message: string;
	readonly hint?: string;
	readonly docs?: string;
	readonly requestId?: string;
}

export class HttpError extends Error {
	readonly status: number;
	readonly code: string;
	readonly hint: string | undefined;
	readonly docs: string | undefined;
	readonly requestId: string | undefined;
	constructor(api: ApiError) {
		super(api.message);
		this.name = "HttpError";
		this.status = api.status;
		this.code = api.code;
		this.hint = api.hint;
		this.docs = api.docs;
		this.requestId = api.requestId;
	}
}

export async function request<T>(
	ctx: RequestContext,
	path: string,
	schema: z.ZodType<T>,
	opts: RequestOptions = {},
): Promise<T> {
	const res = await rawRequest(ctx, path, opts);
	const text = await res.text();
	if (!res.ok) {
		throw decodeError(res.status, text);
	}
	if (text.length === 0) {
		return schema.parse(undefined);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new HttpError({
			status: res.status,
			code: "invalid_response",
			message: `Runtime returned a non-JSON body (status ${res.status}).`,
		});
	}
	return schema.parse(parsed);
}

export async function rawRequest(
	ctx: RequestContext,
	path: string,
	opts: RequestOptions = {},
): Promise<Response> {
	const env = ctx.env ?? process.env;
	const url = buildUrl(ctx.profile.url, path, opts.query);
	const headers: Record<string, string> = {
		Accept: "application/json",
		...(opts.headers ?? {}),
	};
	// OIDC bearer takes precedence over API key when both are present
	// — the user can flip between API-key and OIDC auth without
	// stomping the other slot. Caller-supplied headers still win
	// (used by the device-flow login command, which talks to the
	// runtime before any credentials are saved).
	if (!headers.Authorization) {
		const oidcToken = ctx.profile.oidc?.accessToken;
		if (oidcToken) {
			const scheme = ctx.profile.oidc?.tokenType ?? "Bearer";
			headers.Authorization = `${scheme} ${oidcToken}`;
		} else if (ctx.profile.apiKey) {
			headers.Authorization = `Bearer ${ctx.profile.apiKey}`;
		}
	}
	const init: RequestInit = {
		method: opts.method ?? "GET",
		headers,
	};
	if (opts.body !== undefined && opts.body !== null) {
		if (opts.body instanceof FormData) {
			init.body = opts.body;
		} else if (opts.body instanceof Uint8Array) {
			init.body = opts.body;
		} else if (typeof opts.body === "string") {
			init.body = opts.body;
		} else {
			init.body = JSON.stringify(opts.body);
			headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
		}
	}
	const timeoutMs = resolveTimeout(env, opts.timeoutMs);
	const retries = resolveRetries(env, opts.retries);
	let attempt = 0;
	let lastErr: unknown;
	while (attempt <= retries) {
		const attemptInit = withTimeout(init, opts.signal, timeoutMs);
		try {
			return await fetch(url, attemptInit.init);
		} catch (err: unknown) {
			lastErr = err;
			attempt += 1;
			if (attempt > retries || isExternalAbort(err, opts.signal)) {
				throw new HttpError({
					status: 0,
					code: classifyNetworkError(err, attemptInit.timedOut),
					message: `Could not reach ${ctx.profile.url}: ${describeError(err)}`,
				});
			}
			await sleep(RETRY_BACKOFF_MS);
		} finally {
			attemptInit.dispose();
		}
	}
	// Unreachable: the loop either returns or throws inside.
	throw new HttpError({
		status: 0,
		code: "network_error",
		message: `Could not reach ${ctx.profile.url}: ${describeError(lastErr)}`,
	});
}

export function buildUrl(
	base: string,
	path: string,
	query?: RequestOptions["query"],
): string {
	const trimmed = base.replace(/\/+$/, "");
	const cleaned = path.startsWith("/") ? path : `/${path}`;
	const u = new URL(`${trimmed}${cleaned}`);
	if (query) {
		for (const [k, v] of Object.entries(query)) {
			if (v === undefined || v === null) continue;
			u.searchParams.set(k, String(v));
		}
	}
	return u.toString();
}

interface AttemptInit {
	readonly init: RequestInit;
	readonly dispose: () => void;
	timedOut: boolean;
}

function withTimeout(
	base: RequestInit,
	external: AbortSignal | undefined,
	timeoutMs: number,
): AttemptInit {
	const controller = new AbortController();
	const state = { timedOut: false };
	let externalAbortListener: (() => void) | null = null;
	if (external) {
		if (external.aborted) controller.abort(external.reason);
		else {
			externalAbortListener = () => controller.abort(external.reason);
			external.addEventListener("abort", externalAbortListener, { once: true });
		}
	}
	const timer = setTimeout(() => {
		state.timedOut = true;
		controller.abort(new Error(`request timed out after ${timeoutMs}ms`));
	}, timeoutMs);
	return {
		init: { ...base, signal: controller.signal },
		get timedOut() {
			return state.timedOut;
		},
		set timedOut(_) {
			// no-op; controlled by the timeout closure
		},
		dispose() {
			clearTimeout(timer);
			if (externalAbortListener) {
				external?.removeEventListener("abort", externalAbortListener);
			}
		},
	};
}

function decodeError(status: number, body: string): HttpError {
	let code = `http_${status}`;
	let message = body || `Request failed with status ${status}`;
	let hint: string | undefined;
	let docs: string | undefined;
	let requestId: string | undefined;
	if (body.length > 0) {
		try {
			const parsed = ErrorEnvelopeSchema.safeParse(JSON.parse(body));
			if (parsed.success) {
				code = parsed.data.error.code ?? code;
				message = parsed.data.error.message ?? message;
				hint = parsed.data.error.hint;
				docs = parsed.data.error.docs;
				requestId = parsed.data.error.requestId;
			}
		} catch {
			// keep defaults
		}
	}
	return new HttpError({ status, code, message, hint, docs, requestId });
}

function describeError(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

function classifyNetworkError(_err: unknown, timedOut: boolean): string {
	if (timedOut) return "request_timeout";
	return "network_error";
}

function isExternalAbort(
	err: unknown,
	external: AbortSignal | undefined,
): boolean {
	if (!external?.aborted) return false;
	if (!(err instanceof Error)) return false;
	return err.name === "AbortError";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTimeout(
	env: NodeJS.ProcessEnv,
	override: number | undefined,
): number {
	if (typeof override === "number" && override > 0) return override;
	const raw = env.AIW_REQUEST_TIMEOUT_MS;
	if (raw) {
		const n = Number(raw);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return DEFAULT_TIMEOUT_MS;
}

function resolveRetries(
	env: NodeJS.ProcessEnv,
	override: number | undefined,
): number {
	if (typeof override === "number" && override >= 0) return override;
	const raw = env.AIW_REQUEST_RETRIES;
	if (raw !== undefined) {
		const n = Number(raw);
		if (Number.isFinite(n) && n >= 0) return n;
	}
	return DEFAULT_RETRIES;
}
