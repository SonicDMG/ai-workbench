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
import { storeFromConfig } from "./control-plane/factory.js";
import { buildVectorStoreDriverRegistry } from "./drivers/factory.js";
import { makeEmbedderFactory } from "./embeddings/factory.js";
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

	const store = await storeFromConfig(config, secrets);
	const drivers = buildVectorStoreDriverRegistry({ secrets });
	const embedders = makeEmbedderFactory({ secrets });
	const auth = await buildAuthResolver(config.auth, { store });

	const login = await buildLoginOptions(config.auth, secrets);

	const uiDir = resolveUiDir(config.runtime.uiDir);
	const ui = uiDir ? buildUiAssets(uiDir) : null;
	if (uiDir) {
		logger.info({ uiDir }, "ui enabled");
	} else {
		logger.info(
			"ui disabled — no dist found and runtime.uiDir not set; set runtime.uiDir or UI_DIR to serve the web UI from the runtime",
		);
	}

	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders,
		ui,
		login,
		requestIdHeader: config.runtime.requestIdHeader,
	});

	const port = config.runtime.port;
	serve({ fetch: app.fetch, port }, async (info) => {
		const workspaces = await store.listWorkspaces();
		logger.info(
			{
				port: info.port,
				controlPlane: config.controlPlane.driver,
				authMode: config.auth.mode,
				anonymousPolicy: config.auth.anonymousPolicy,
				ui: ui !== null,
				workspaces: workspaces.length,
			},
			"ai-workbench listening",
		);
	});

	const shutdown = (signal: string) => async () => {
		logger.info({ signal }, "shutting down");
		await store.close?.();
		process.exit(0);
	};
	process.on("SIGINT", shutdown("SIGINT"));
	process.on("SIGTERM", shutdown("SIGTERM"));
}

async function buildLoginOptions(
	authCfg: AuthConfig,
	secrets: SecretResolver,
): Promise<AppLoginOptions | null> {
	const clientCfg = authCfg.oidc?.client;
	if (!authCfg.oidc || !clientCfg) {
		return {
			authConfig: authCfg,
			endpoints: null,
			clientSecret: null,
			cookie: null,
			pending: null,
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
		},
		"oidc browser-login enabled",
	);

	return {
		authConfig: authCfg,
		endpoints,
		clientSecret,
		cookie,
		pending,
	};
}

main().catch((err: unknown) => {
	logger.error({ err }, "startup failed");
	process.exit(1);
});
