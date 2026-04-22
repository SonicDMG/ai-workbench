/**
 * Mock Astra Data API server for cross-language conformance testing.
 *
 * Purpose: stand in for a real Astra endpoint, capture every inbound
 * request, and return just enough of a successful response to let
 * clients continue executing a scenario.
 *
 * NOT a faithful Astra Data API implementation. It does not persist
 * state, does not enforce schemas, does not return realistic error
 * bodies. It exists only to record what the client sends so we can diff
 * it against fixtures.
 *
 * Capture protocol:
 *   POST /_reset           → clear captured requests, 204.
 *   GET  /_captured        → return captured requests as JSON, 200.
 *   *                      → everything else is "normal" traffic; capture
 *                             the request and return a stub success body.
 *
 * Captured request shape:
 *   {
 *     method: "POST",
 *     path: "/api/json/v1/workbench/wb_workspaces",
 *     headers: { "content-type": "application/json", ... },
 *     body: <parsed JSON, or string if not JSON>
 *   }
 *
 * Run from repo root:
 *   npm run conformance:mock
 * Or directly (from runtimes/typescript):
 *   tsx ../../conformance/mock-astra/server.ts
 */

import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";

interface CapturedRequest {
	readonly method: string;
	readonly path: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: unknown;
}

const PORT = Number(process.env.PORT ?? 4010);
const HOST = process.env.HOST ?? "127.0.0.1";

const captured: CapturedRequest[] = [];

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function normalizeHeaders(
	raw: IncomingMessage["headers"],
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (v === undefined) continue;
		out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
	}
	return out;
}

function parseBody(bodyText: string, contentType: string | undefined): unknown {
	if (!bodyText) return null;
	if ((contentType ?? "").includes("application/json")) {
		try {
			return JSON.parse(bodyText);
		} catch {
			return bodyText;
		}
	}
	return bodyText;
}

/** Return just enough response to satisfy a Data API client. */
function stubResponse(body: unknown): Record<string, unknown> {
	// Echo a plausible Data API envelope. Clients that parse this will
	// get a success, though specific fields (e.g. insertedIds) are not
	// faithful — conformance tests assert on OUTBOUND payloads, not on
	// what the client does with our response.
	return {
		status: {
			ok: 1,
			mock: true,
			echoedBodyShape: typeof body,
		},
	};
}

async function handle(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const url = new URL(req.url ?? "/", `http://${HOST}`);
	const path = url.pathname;

	// Capture-protocol endpoints come first so they don't pollute the log.
	if (path === "/_reset" && req.method === "POST") {
		captured.length = 0;
		res.writeHead(204).end();
		return;
	}
	if (path === "/_captured" && req.method === "GET") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify(captured, null, 2));
		return;
	}
	if (path === "/_health") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: true }));
		return;
	}

	const bodyText = await readBody(req);
	const headers = normalizeHeaders(req.headers);
	const body = parseBody(bodyText, headers["content-type"]);

	captured.push({
		method: req.method ?? "GET",
		path,
		headers,
		body,
	});

	res.writeHead(200, { "content-type": "application/json" });
	res.end(JSON.stringify(stubResponse(body)));
}

const server = createServer((req, res) => {
	handle(req, res).catch((err) => {
		// eslint-disable-next-line no-console
		console.error("[mock-astra] handler error", err);
		if (!res.headersSent) res.writeHead(500);
		res.end();
	});
});

server.listen(PORT, HOST, () => {
	// eslint-disable-next-line no-console
	console.log(`[mock-astra] listening on http://${HOST}:${PORT}`);
});
