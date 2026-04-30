import { serve } from "@hono/node-server";
import { type AppLoginOptions, createApp } from "./app.js";
import { assertSafeAuthDeployment } from "./auth/deployment-guard.js";
import { buildAuthResolver } from "./auth/factory.js";
import {
	generateSessionKey,
	makeCookieSigner,
} from "./auth/oidc/login/cookie.js";
import { fetchOidcEndpoints } from "./auth/oidc/login/discovery.js";
import { MemoryPendingLoginStore } from "./auth/oidc/login/pending.js";
import { buildChatService } from "./chat/factory.js";
import {
	type AstraCliInfo,
	loadAstraFromCli,
	toAstraCliInfo,
} from "./config/astra-cli.js";
import { loadDotEnv } from "./config/env-file.js";
import { loadConfig, resolveConfigPath } from "./config/loader.js";
import type { AuthConfig } from "./config/schema.js";
import { controlPlaneFromConfig } from "./control-plane/factory.js";
import { buildVectorStoreDriverRegistry } from "./drivers/factory.js";
import { makeEmbedderFactory } from "./embeddings/factory.js";
import { buildJobStore } from "./jobs/factory.js";
import { runKbIngestJob } from "./jobs/ingest-worker.js";
import { JobOrphanSweeper } from "./jobs/sweeper.js";
import { applyLogLevel, logger } from "./lib/logger.js";
import { generateReplicaId } from "./lib/replica-id.js";
import { EnvSecretProvider } from "./secrets/env.js";
import { FileSecretProvider } from "./secrets/file.js";
import { SecretResolver } from "./secrets/provider.js";
import { buildUiAssets, resolveUiDir } from "./ui/assets.js";

async function main(): Promise<void> {
	// Load .env (repo-root by default) before anything reads `process.env`.
	const envFile = loadDotEnv();
	if (envFile.path) {
		logger.info(
			{ envFile: envFile.path, source: envFile.source },
			"loaded env file",
		);
	}

	// Optionally fill in ASTRA_DB_API_ENDPOINT / ASTRA_DB_APPLICATION_TOKEN
	// from the developer's astra-cli profile when those env vars aren't
	// already set. No-op when the CLI isn't installed or both variables
	// are already present.
	const astraCliResult = await loadAstraFromCli({
		logger: {
			info: (msg, fields) => logger.info(fields ?? {}, msg),
			warn: (msg, fields) => logger.warn(fields ?? {}, msg),
			debug: (msg, fields) => logger.debug(fields ?? {}, msg),
		},
	});
	if (astraCliResult.status === "loaded") {
		logger.info(
			{
				profile: astraCliResult.profile,
				database: astraCliResult.database.name,
				region: astraCliResult.database.region,
			},
			"astra-cli credentials applied",
		);
	}
	const astraCli: AstraCliInfo = toAstraCliInfo(astraCliResult);

	const configPath = resolveConfigPath();
	logger.info({ configPath }, "loading config");

	const config = await loadConfig(configPath);

	const logLevel = applyLogLevel(config.runtime.logLevel);
	logger.info(
		{ level: logLevel.level, source: logLevel.source },
		"log level set",
	);

	const secrets = new SecretResolver({
		env: new EnvSecretProvider(),
		file: new FileSecretProvider(),
	});

	const { store, astraTables } = await controlPlaneFromConfig(config, secrets);
	const jobs = await buildJobStore({
		controlPlane: config.controlPlane,
		astraTables,
	});
	const drivers = buildVectorStoreDriverRegistry({ secrets });
	const embedders = makeEmbedderFactory({ secrets });
	const auth = await buildAuthResolver(config.auth, { store, secrets });
	assertSafeAuthDeployment(config);
	warnOnOpenMcpAuth(config);

	const login = await buildLoginOptions(config.auth, secrets, {
		publicOrigin: config.runtime.publicOrigin,
		trustProxyHeaders: config.runtime.trustProxyHeaders,
	});

	const uiDir = resolveUiDir(config.runtime.uiDir);
	const ui = uiDir ? buildUiAssets(uiDir) : null;
	if (uiDir) {
		logger.info({ uiDir }, "ui enabled");
	} else {
		logger.info(
			"ui disabled — no dist found and runtime.uiDir not set; set runtime.uiDir or UI_DIR to serve the web UI from the runtime",
		);
	}

	const readiness = { draining: false };
	const replicaId = config.runtime.replicaId ?? generateReplicaId();

	const chatService = await buildChatService({
		config: config.chat ?? null,
		secrets,
	});
	if (chatService) {
		logger.info({ model: chatService.modelId }, "chat service initialized");
	} else {
		logger.info(
			"chat service not configured — POST /chats/{id}/messages will return 503 chat_disabled until a `chat` block is added to workbench.yaml",
		);
	}

	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders,
		environment: config.runtime.environment,
		jobs,
		ui,
		login,
		readiness,
		astraCli,
		chatService,
		chatConfig: config.chat ?? null,
		mcpConfig: config.mcp,
		requestIdHeader: config.runtime.requestIdHeader,
		rateLimit: {
			enabled: config.runtime.rateLimit.enabled,
			capacity: config.runtime.rateLimit.capacity,
			windowMs: config.runtime.rateLimit.windowMs,
			trustProxyHeaders: config.runtime.trustProxyHeaders,
		},
		replicaId,
	});

	// Cross-replica orphan-sweeper. Off by default — clustered
	// deployments opt in via `controlPlane.jobsResume.enabled` so the
	// single-replica reference deployment doesn't pay for it. When
	// on, reclaimed orphans with a persisted `ingestInput` snapshot
	// flow through `runKbIngestJob` for a real resume; orphans without
	// one fall back to mark-failed.
	const sweeperCfg = config.controlPlane.jobsResume;
	const sweeper =
		sweeperCfg?.enabled === true
			? new JobOrphanSweeper({
					jobs,
					replicaId,
					graceMs: sweeperCfg.graceMs,
					intervalMs: sweeperCfg.intervalMs,
					resume: ({ workspaceId, jobId, replicaId: rid, input }) => {
						void runKbIngestJob({
							deps: { store, drivers, embedders, jobs },
							workspaceId,
							jobId,
							replicaId: rid,
							input,
						});
					},
				})
			: null;
	if (sweeper) {
		sweeper.start();
		logger.info(
			{
				replicaId,
				graceMs: sweeperCfg?.graceMs,
				intervalMs: sweeperCfg?.intervalMs,
			},
			"job orphan sweeper enabled",
		);
	}

	const port = config.runtime.port;
	const server = serve({ fetch: app.fetch, port }, async (info) => {
		const workspaces = await store.listWorkspaces();
		logger.info(
			{
				port: info.port,
				environment: config.runtime.environment,
				controlPlane: config.controlPlane.driver,
				authMode: config.auth.mode,
				anonymousPolicy: config.auth.anonymousPolicy,
				ui: ui !== null,
				workspaces: workspaces.length,
			},
			"ai-workbench listening",
		);
	});

	// Graceful shutdown: stop accepting new connections, wait for
	// in-flight requests to finish (up to SHUTDOWN_TIMEOUT_MS), then
	// close the control plane and exit. A second signal short-circuits
	// straight to exit so operators can force-kill a stuck process.
	const SHUTDOWN_TIMEOUT_MS = 15_000;
	let shuttingDown = false;
	const shutdown = (signal: string) => () => {
		if (shuttingDown) {
			logger.warn({ signal }, "second shutdown signal — forcing exit");
			process.exit(1);
			return;
		}
		shuttingDown = true;
		readiness.draining = true;
		logger.info(
			{ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS },
			"shutting down — /readyz now returns 503, draining in-flight requests",
		);

		const forceKill = setTimeout(() => {
			logger.error(
				{ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS },
				"in-flight requests did not drain in time — forcing exit",
			);
			process.exit(1);
		}, SHUTDOWN_TIMEOUT_MS);
		forceKill.unref();

		// Stop the orphan-sweeper before draining the server so its
		// next tick doesn't fire mid-shutdown.
		sweeper?.stop();
		server.close(async (err) => {
			if (err) {
				logger.error({ err: err.message }, "server.close failed");
			}
			try {
				await store.close?.();
			} catch (closeErr) {
				logger.error(
					{ err: closeErr instanceof Error ? closeErr.message : "unknown" },
					"control-plane close failed",
				);
			}
			// Stop the cross-replica job-subscriber poller (a no-op for
			// memory/file backends that don't have one). Duck-typed —
			// `stop()` is optional on JobStore so backends opt in when
			// they have something to clean up.
			try {
				const maybeStop = (jobs as { stop?: () => void }).stop;
				if (typeof maybeStop === "function") {
					maybeStop.call(jobs);
				}
			} catch (stopErr) {
				logger.error(
					{ err: stopErr instanceof Error ? stopErr.message : "unknown" },
					"job store stop failed",
				);
			}
			clearTimeout(forceKill);
			process.exit(err ? 1 : 0);
		});
	};
	process.on("SIGINT", shutdown("SIGINT"));
	process.on("SIGTERM", shutdown("SIGTERM"));
}

/**
 * Warn when MCP is enabled but auth is in its default open state.
 *
 * `auth.mode: disabled` (the dev default) means any caller who
 * discovers the MCP URL gets unrestricted access to every workspace.
 * This is fine on a loopback dev runtime; it is dangerous the moment
 * the port is forwarded, tunnelled, or deployed anywhere reachable
 * from outside the developer's machine.
 *
 * We log WARN rather than refusing to start so existing quick-start
 * configs keep working — but the message is loud enough that it shows
 * up in the terminal when the developer enables MCP for the first time.
 */
function warnOnOpenMcpAuth(config: {
	readonly mcp: { readonly enabled: boolean };
	readonly auth: {
		readonly mode: string;
		readonly anonymousPolicy: string;
	};
}): void {
	if (!config.mcp.enabled) {
		return;
	}
	if (
		config.auth.mode !== "disabled" &&
		config.auth.anonymousPolicy === "reject"
	) {
		return;
	}
	logger.warn(
		{
			authMode: config.auth.mode,
			anonymousPolicy: config.auth.anonymousPolicy,
			mcpPath: "/api/v1/workspaces/{workspaceId}/mcp",
		},
		"MCP is enabled with open auth — any caller who knows the workspace URL has unrestricted MCP access; " +
			"set auth.mode to apiKey/oidc/any with anonymousPolicy: reject and mint a workspace API key per agent before exposing this runtime",
	);
}

async function buildLoginOptions(
	authCfg: AuthConfig,
	secrets: SecretResolver,
	runtime: {
		readonly publicOrigin: string | null;
		readonly trustProxyHeaders: boolean;
	},
): Promise<AppLoginOptions | null> {
	const clientCfg = authCfg.oidc?.client;
	if (!authCfg.oidc || !clientCfg) {
		return {
			authConfig: authCfg,
			endpoints: null,
			clientSecret: null,
			cookie: null,
			pending: null,
			publicOrigin: runtime.publicOrigin,
			trustProxyHeaders: runtime.trustProxyHeaders,
		};
	}

	// One-time network fetch at boot. Login + verifier share the
	// same discovery doc — this currently does it twice (once here,
	// once inside the verifier factory) to keep the modules
	// decoupled; if it becomes a cold-start issue we'll cache.
	const endpoints = await fetchOidcEndpoints({ issuer: authCfg.oidc.issuer });

	const clientSecret = clientCfg.clientSecretRef
		? await secrets.resolve(clientCfg.clientSecretRef)
		: null;

	let sessionKey: Buffer;
	if (clientCfg.sessionSecretRef) {
		const raw = await secrets.resolve(clientCfg.sessionSecretRef);
		sessionKey = Buffer.from(raw, "utf8");
		if (sessionKey.length < 32) {
			throw new Error(
				"auth.oidc.client.sessionSecretRef must resolve to >=32 bytes of entropy",
			);
		}
	} else {
		// Reaching here means `assertSafeAuthDeployment` already
		// confirmed we're on a memory control plane (the durable-store
		// gate would have refused to start otherwise). Ephemeral key is
		// fine for an in-memory dev runtime; sessions die with the
		// process anyway.
		sessionKey = generateSessionKey();
		logger.warn(
			"auth.oidc.client.sessionSecretRef is not set — generated an ephemeral session key for the in-memory control plane. All browser sessions invalidate on restart; this is rejected automatically on file/astra control planes.",
		);
	}
	const cookie = makeCookieSigner(sessionKey);
	const pending = new MemoryPendingLoginStore();

	logger.info(
		{
			clientId: clientCfg.clientId,
			redirectPath: clientCfg.redirectPath,
			hasSecret: clientSecret !== null,
			hasPersistentKey: clientCfg.sessionSecretRef !== null,
			publicOrigin: runtime.publicOrigin,
			trustProxyHeaders: runtime.trustProxyHeaders,
		},
		"oidc browser-login enabled",
	);

	return {
		authConfig: authCfg,
		endpoints,
		clientSecret,
		cookie,
		pending,
		publicOrigin: runtime.publicOrigin,
		trustProxyHeaders: runtime.trustProxyHeaders,
	};
}

main().catch((err: unknown) => {
	logger.error({ err }, "startup failed");
	process.exit(1);
});
