/**
 * Wire-format converters — the single boundary where internal control-
 * plane records become public API JSON.
 *
 * Each `toWire*` function takes the readonly internal record shape and
 * returns the mutable wire object Hono's OpenAPI response typing
 * expects. Cloning at this seam is cheaper than relaxing the in-memory
 * record types to `string[]` everywhere.
 *
 * Routes import only from this barrel — never reach into a sibling
 * module. New record types should add their converter here too, not
 * inline in the route handler.
 */

export {
	isUserVisibleMessage,
	toWireAgent,
	toWireChatMessage,
	toWireConversation,
} from "./agent.js";
export { toWireApiKey } from "./api-key.js";
export { toWireJob } from "./job.js";
export {
	toWireEmbedding,
	toWireLlm,
	toWireMcpTool,
	toWirePage,
	toWireReranking,
} from "./service.js";
export { toWireWorkspace } from "./workspace.js";
