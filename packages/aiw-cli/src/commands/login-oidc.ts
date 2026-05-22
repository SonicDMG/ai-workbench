/**
 * `aiw login --oidc` — RFC 8628 device-flow login.
 *
 * Talks to the workbench runtime's `/auth/device/authorize` +
 * `/auth/device/token` proxy (which fronts the configured IdP), so
 * the CLI never needs the IdP issuer URL and the IdP client secret
 * stays server-side. The resulting access token is whatever the
 * existing OIDC verifier validates today — no new verifier path on
 * either side.
 *
 * Polling cadence honours the IdP-supplied `interval`, backs off on
 * RFC 8628 §3.5 `slow_down`, and stops on `expired_token` /
 * `access_denied`. The user can cancel at any time with Ctrl+C; the
 * pending device code expires server-side on the IdP's clock so
 * nothing leaks.
 */

import * as p from "@clack/prompts";
import {
	defaultConfigLocation,
	type OidcCredentials,
	type Profile,
	readConfig,
	setProfile,
	writeConfig,
} from "../config.js";
import { ExitCode } from "../exit-codes.js";
import { fail, info, success, warn } from "../output.js";

interface DeviceAuthorization {
	readonly device_code: string;
	readonly user_code: string;
	readonly verification_uri: string;
	readonly verification_uri_complete?: string;
	readonly expires_in: number;
	readonly interval: number;
}

interface DeviceTokenSuccess {
	readonly access_token: string;
	readonly token_type: string;
	readonly expires_in?: number;
	readonly refresh_token?: string;
	readonly scope?: string;
}

const POLL_DEADLINE_FUDGE_SECONDS = 5;
const DEFAULT_INTERVAL_SECONDS = 5;
const SLOW_DOWN_INCREMENT_SECONDS = 5;

export async function runDeviceFlowLogin(opts: {
	readonly url: string;
	readonly profileName: string;
}): Promise<void> {
	const baseUrl = opts.url.replace(/\/+$/, "");

	const dev = await startDeviceAuthorization(baseUrl);

	const verification = dev.verification_uri_complete ?? dev.verification_uri;
	info(
		[
			"Open this URL in your browser to approve the login:",
			`  ${verification}`,
			dev.verification_uri_complete
				? `(plain URL: ${dev.verification_uri})`
				: "",
			`Enter the code: ${dev.user_code}`,
			`The code expires in ${Math.round(dev.expires_in / 60)} minute(s).`,
			"",
			"Waiting for approval (Ctrl+C to cancel)…",
		]
			.filter(Boolean)
			.join("\n"),
	);

	const tokens = await pollForToken(baseUrl, dev);

	const expiresAt = tokens.expires_in
		? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
		: undefined;

	const oidc: OidcCredentials = {
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresAt,
		tokenType: tokens.token_type || "Bearer",
	};

	const profile: Profile = { url: opts.url, oidc };
	const loc = defaultConfigLocation();
	const current = await readConfig(loc);
	const next = setProfile(current, opts.profileName, profile);
	await writeConfig(next, loc);

	success(`Saved profile "${opts.profileName}" at ${loc.file}.`);
	if (expiresAt) {
		info(
			`Token expires at ${expiresAt} — re-run \`aiw login --oidc\` to refresh.`,
		);
	} else {
		info(
			"Runtime didn't return an `expires_in`; if commands start 401-ing, re-run `aiw login --oidc`.",
		);
	}
}

async function startDeviceAuthorization(
	baseUrl: string,
): Promise<DeviceAuthorization> {
	const res = await fetch(`${baseUrl}/auth/device/authorize`, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: "{}",
	});
	if (res.status === 501) {
		fail(
			"The runtime's OIDC IdP doesn't advertise a device-authorization endpoint. Use `aiw login` (API key) instead, or configure an IdP that supports RFC 8628 (Auth0 / Okta / Keycloak / Google all do by default).",
		);
		process.exit(ExitCode.USAGE_ERROR);
	}
	if (!res.ok) {
		const text = await res.text();
		fail(`Device authorization failed (${res.status}): ${text}`);
		process.exit(ExitCode.USAGE_ERROR);
	}
	const body = (await res.json()) as Partial<DeviceAuthorization>;
	if (
		typeof body.device_code !== "string" ||
		typeof body.user_code !== "string" ||
		typeof body.verification_uri !== "string" ||
		typeof body.expires_in !== "number"
	) {
		fail(
			"Runtime returned an unexpected device-authorization shape — missing device_code / user_code / verification_uri / expires_in.",
		);
		process.exit(ExitCode.USAGE_ERROR);
	}
	return {
		device_code: body.device_code,
		user_code: body.user_code,
		verification_uri: body.verification_uri,
		verification_uri_complete: body.verification_uri_complete,
		expires_in: body.expires_in,
		interval: body.interval ?? DEFAULT_INTERVAL_SECONDS,
	};
}

async function pollForToken(
	baseUrl: string,
	dev: DeviceAuthorization,
): Promise<DeviceTokenSuccess> {
	const deadline =
		Date.now() + (dev.expires_in - POLL_DEADLINE_FUDGE_SECONDS) * 1000;
	let interval = Math.max(1, dev.interval) * 1000;

	const spinner = p.spinner();
	spinner.start("Waiting for browser approval…");
	try {
		while (Date.now() < deadline) {
			await sleep(interval);
			const res = await fetch(`${baseUrl}/auth/device/token`, {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ device_code: dev.device_code }),
			});
			if (res.ok) {
				const body = (await res.json()) as Partial<DeviceTokenSuccess>;
				if (typeof body.access_token !== "string") {
					spinner.stop("Runtime returned no access_token.");
					fail("Token response missing `access_token`.");
					process.exit(ExitCode.USAGE_ERROR);
				}
				spinner.stop("Login approved.");
				return {
					access_token: body.access_token,
					token_type: body.token_type ?? "Bearer",
					expires_in: body.expires_in,
					refresh_token: body.refresh_token,
					scope: body.scope,
				};
			}
			// Non-2xx: parse the IdP-style envelope for the next action.
			const text = await res.text();
			const code = extractErrorCode(text);
			if (code === "authorization_pending") {
				continue;
			}
			if (code === "slow_down") {
				interval += SLOW_DOWN_INCREMENT_SECONDS * 1000;
				warn(
					`IdP asked us to slow down — increasing poll interval to ${interval / 1000}s.`,
				);
				continue;
			}
			if (code === "expired_token") {
				spinner.stop("Device code expired.");
				fail("The login code expired — re-run `aiw login --oidc`.");
				process.exit(ExitCode.USAGE_ERROR);
			}
			if (code === "access_denied") {
				spinner.stop("Login denied.");
				fail("The login was denied in the browser.");
				process.exit(ExitCode.USAGE_ERROR);
			}
			spinner.stop("Device-flow login failed.");
			fail(`Runtime returned ${res.status} ${code ?? "unknown"}: ${text}`);
			process.exit(ExitCode.USAGE_ERROR);
		}
		// Loop exited because the device code expired while we were
		// polling — surface a clear hint to the user.
		spinner.stop("Device code expired before approval.");
		fail("Login timed out — re-run `aiw login --oidc` to start over.");
		process.exit(ExitCode.USAGE_ERROR);
	} finally {
		spinner.stop();
	}
}

function extractErrorCode(text: string): string | null {
	try {
		const parsed = JSON.parse(text) as { error?: { code?: string } };
		return parsed.error?.code ?? null;
	} catch {
		return null;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
