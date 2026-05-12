/**
 * Aggregated registry of per-framework snippet generators.
 *
 * The ordering here is the UI's tab order. It is deliberately stable:
 * customers screenshot the Connect tab into slide decks, and shuffling
 * the order over time would break those screenshots. Add new targets
 * at the end. The catch-all `mcp-raw` smoke-test tab stays last.
 */

import type {
	ConnectSnippet,
	ConnectTargetId,
	SnippetContext,
	SnippetGenerator,
} from "../types.js";
import { buildCrewAiSnippet } from "./crewai.js";
import { buildGoogleAdkSnippet } from "./google-adk.js";
import { buildLangGraphSnippet } from "./langgraph.js";
import { buildMcpRawSnippet } from "./mcp-raw.js";
import { buildMicrosoftAgentFrameworkSnippet } from "./microsoft-agent-framework.js";
import { buildWatsonxSnippet } from "./watsonx.js";

const REGISTRY: readonly { id: ConnectTargetId; build: SnippetGenerator }[] = [
	{ id: "langgraph", build: buildLangGraphSnippet },
	{ id: "crewai", build: buildCrewAiSnippet },
	{ id: "google-adk", build: buildGoogleAdkSnippet },
	{
		id: "microsoft-agent-framework",
		build: buildMicrosoftAgentFrameworkSnippet,
	},
	{ id: "watsonx", build: buildWatsonxSnippet },
	{ id: "mcp-raw", build: buildMcpRawSnippet },
];

/**
 * Render every snippet in the registry against the given context.
 *
 * Pure function — no I/O. The route layer does the workspace
 * existence check and resolves `publicBaseUrl` before calling this.
 */
export function buildAllSnippets(
	ctx: SnippetContext,
): readonly ConnectSnippet[] {
	return REGISTRY.map((entry) => entry.build(ctx));
}

/**
 * Render exactly one snippet. Returns `null` when the id is unknown so
 * the route can map that to a 404 cleanly.
 */
export function buildSingleSnippet(
	id: ConnectTargetId,
	ctx: SnippetContext,
): ConnectSnippet | null {
	const entry = REGISTRY.find((row) => row.id === id);
	return entry ? entry.build(ctx) : null;
}

/**
 * Every {@link ConnectTargetId} the registry knows about, in tab order.
 * Used by Zod enums and tests; never re-derive from the array shape.
 */
export const CONNECT_TARGET_IDS: readonly ConnectTargetId[] = REGISTRY.map(
	(row) => row.id,
);
