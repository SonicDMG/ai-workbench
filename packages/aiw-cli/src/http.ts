/**
 * HTTP client used by every CLI command.
 *
 * Wraps the global `fetch` so commands stay terse: a single
 * {@link request} call dispatches an authed JSON request, decodes the
 * Workbench's error envelope on non-2xx, and returns a parsed body.
 * Streaming responses (file upload, chat) use {@link rawRequest}
 * instead and inspect `Response` directly.
 *
 * Auth is API-key only in 0.1.0 — the resolved profile's `apiKey`
 * goes on the `Authorization: Bearer ...` header. OIDC device-flow
 * lands post-0.1.0.
 */
import { z } from "zod";
import type { Profile } from "./config.js";

const ErrorEnvelopeSchema = z.object({
	error: z
		.object({
			code: z.string().optional(),
			message: z.string().optional(),
		})
		.passthrough(),
});

export interface RequestOptions {
	readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	readonly query?: Record<string, string | number | boolean | undefined>;
	readonly body?: unknown;
	readonly headers?: Record<string, string>;
	readonly signal?: AbortSignal;
}

export interface RequestContext {
	readonly profile: Profile;
}

export interface ApiError {
	readonly status: number;
	readonly code: string;
	readonly message: string;
}

export class HttpError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(api: ApiError) {
		super(api.message);
		this.name = "HttpError";
		this.status = api.status;
		this.code = api.code;
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
		signal: opts.signal,
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
	try {
		return await fetch(url, init);
	} catch (err: unknown) {
		throw new HttpError({
			status: 0,
			code: "network_error",
			message: `Could not reach ${ctx.profile.url}: ${describeError(err)}`,
		});
	}
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

function decodeError(status: number, body: string): HttpError {
	let code = `http_${status}`;
	let message = body || `Request failed with status ${status}`;
	if (body.length > 0) {
		try {
			const parsed = ErrorEnvelopeSchema.safeParse(JSON.parse(body));
			if (parsed.success) {
				code = parsed.data.error.code ?? code;
				message = parsed.data.error.message ?? message;
			}
		} catch {
			// keep defaults
		}
	}
	return new HttpError({ status, code, message });
}

function describeError(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
