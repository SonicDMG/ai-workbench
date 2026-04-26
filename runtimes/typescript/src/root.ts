import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { type AppLoginOptions, createApp } from "./app.js";
import { buildAuthResolver } from "./auth/factory.js";
import {
	generateSessionKey,
	makeCookieSigner,
} from "./auth/oidc/login/cookie.js";
import { fetchOidcEndpoints } from "./auth/oidc/login/discovery.js";
import { MemoryPendingLoginStore } from "./auth/oidc/login/pending.js";
import { loadDotEnv } from "./config/env-file.js";
import { loadConfig, resolveConfigPath } from "./config/loader.js";
import type { AuthConfig } from "./config/schema.js";
import { controlPlaneFromConfig } from "./control-plane/factory.js";
import { buildVectorStoreDriverRegistry } from "./drivers/factory.js";
import { makeEmbedderFactory } from "./embeddings/factory.js";
import { buildJobStore } from "./jobs/factory.js";
import { runIngestJob } from "./jobs/ingest-worker.js";
import { JobOrphanSweeper } from "./jobs/sweeper.js";
import { applyLogLevel, logger } from "./lib/logger.js";
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
	warnOnOpenProductionAuth(config);

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
	const replicaId =
		config.runtime.replicaId ??
		`${process.env.HOSTNAME?.trim() || "wb"}-${randomUUID()
			.replace(/-/g, "")
			.slice(0, 8)}`;
	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders,
		jobs,
		ui,
		login,
		readiness,
		requestIdHeader: config.runtime.requestIdHeader,
		replicaId,
	});

	// Cross-replica orphan-sweeper. Off by default — clustered
	// deployments opt in via `controlPlane.jobsResume.enabled` so the
	// single-replica reference deployment doesn't pay for it. When
	// on, reclaimed orphans with a persisted `ingestInput` snapshot
	// flow through `runIngestJob` for a real resume; orphans without
	// one fall back to mark-failed.
	const sweeperCfg = config.controlPlane.jobsResume;
	const sweeper =
		sweeperCfg?.enabled === true
			? new JobOrphanSweeper({
					jobs,
					replicaId,
					graceMs: sweeperCfg.graceMs,
					intervalMs: sweeperCfg.intervalMs,
					resume: ({ workspaceUid, jobId, replicaId: rid, input }) => {
						void runIngestJob({
							deps: { store, drivers, embedders, jobs },
							workspaceUid,
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

function warnOnOpenProductionAuth(config: {
	readonly controlPlane: { readonly driver: string };
	readonly auth: {
		readonly mode: string;
		readonly anonymousPolicy: string;
		readonly bootstrapTokenRef?: string | null;
	};
}): void {
	if (
		config.controlPlane.driver === "memory" ||
		(config.auth.mode !== "disabled" &&
			config.auth.anonymousPolicy === "reject")
	) {
		return;
	}
	logger.warn(
		{
			controlPlane: config.controlPlane.driver,
			authMode: config.auth.mode,
			anonymousPolicy: config.auth.anonymousPolicy,
			hasBootstrapToken: config.auth.bootstrapTokenRef != null,
		},
		"non-memory control plane is accepting anonymous API access; set auth.mode to apiKey/oidc/any with anonymousPolicy: reject before exposing this runtime",
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
		sessionKey = generateSessionKey();
		logger.warn(
			"auth.oidc.client.sessionSecretRef is not set — generated an ephemeral session key. All browser sessions invalidate on restart; set a persistent secret for production.",
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
