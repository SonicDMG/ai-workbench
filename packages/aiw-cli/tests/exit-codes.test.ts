/**
 * Exit-code mapping is a public contract: scripts wrapping `aiw` branch
 * on `$?` and these values are documented in the CLI README. A
 * regression here can silently change script behaviour at customer
 * sites, so we test the whole table exhaustively.
 */

import { describe, expect, test } from "vitest";
import { ExitCode, exitCodeForHttpError } from "../src/exit-codes.js";

describe("ExitCode enum", () => {
	test("has the documented values and they are unique", () => {
		expect(ExitCode.OK).toBe(0);
		expect(ExitCode.RUNTIME_ERROR).toBe(1);
		expect(ExitCode.USAGE_ERROR).toBe(2);
		expect(ExitCode.AUTH_ERROR).toBe(3);
		expect(ExitCode.NOT_FOUND).toBe(4);
		expect(ExitCode.CONFLICT).toBe(5);
		expect(ExitCode.UNAVAILABLE).toBe(6);

		const values = Object.values(ExitCode);
		expect(new Set(values).size).toBe(values.length);
	});
});

describe("exitCodeForHttpError — registry lookup wins over status heuristic", () => {
	test.each([
		// Auth
		["unauthorized", 401, ExitCode.AUTH_ERROR],
		["forbidden", 403, ExitCode.AUTH_ERROR],
		["forbidden_origin", 403, ExitCode.AUTH_ERROR],
		["policy_principal_required", 403, ExitCode.AUTH_ERROR],
		["policy_denied", 403, ExitCode.AUTH_ERROR],
		// Not found
		["not_found", 404, ExitCode.NOT_FOUND],
		["workspace_not_found", 404, ExitCode.NOT_FOUND],
		["knowledge_base_not_found", 404, ExitCode.NOT_FOUND],
		["document_not_found", 404, ExitCode.NOT_FOUND],
		["agent_not_found", 404, ExitCode.NOT_FOUND],
		["agent_template_not_found", 404, ExitCode.NOT_FOUND],
		["conversation_not_found", 404, ExitCode.NOT_FOUND],
		["chat_not_found", 404, ExitCode.NOT_FOUND],
		["chat_message_not_found", 404, ExitCode.NOT_FOUND],
		["chunking_service_not_found", 404, ExitCode.NOT_FOUND],
		["embedding_service_not_found", 404, ExitCode.NOT_FOUND],
		["reranking_service_not_found", 404, ExitCode.NOT_FOUND],
		["llm_service_not_found", 404, ExitCode.NOT_FOUND],
		["api_key_not_found", 404, ExitCode.NOT_FOUND],
		["job_not_found", 404, ExitCode.NOT_FOUND],
		["knowledge_filter_not_found", 404, ExitCode.NOT_FOUND],
		["principal_not_found", 404, ExitCode.NOT_FOUND],
		["collection_not_found", 404, ExitCode.NOT_FOUND],
		// Conflict
		["conflict", 409, ExitCode.CONFLICT],
		["workspace_name_conflict", 409, ExitCode.CONFLICT],
		["workspace_database_conflict", 409, ExitCode.CONFLICT],
		["kb_name_taken", 409, ExitCode.CONFLICT],
		["collection_name_taken", 409, ExitCode.CONFLICT],
		["chunking_service_in_use", 409, ExitCode.CONFLICT],
		["embedding_service_in_use", 409, ExitCode.CONFLICT],
		["reranking_service_in_use", 409, ExitCode.CONFLICT],
		["llm_service_in_use", 409, ExitCode.CONFLICT],
		// Unavailable
		["control_plane_unavailable", 503, ExitCode.UNAVAILABLE],
		["driver_unavailable", 503, ExitCode.UNAVAILABLE],
		["collection_unavailable", 503, ExitCode.UNAVAILABLE],
		["data_api_unavailable", 503, ExitCode.UNAVAILABLE],
		["embedding_unavailable", 503, ExitCode.UNAVAILABLE],
		["chat_disabled", 503, ExitCode.UNAVAILABLE],
		["llm_credential_missing", 503, ExitCode.UNAVAILABLE],
		["draining", 503, ExitCode.UNAVAILABLE],
		["rate_limited", 429, ExitCode.UNAVAILABLE],
		["network_error", 0, ExitCode.UNAVAILABLE],
	])("%s @ %d → %s", (code, status, exit) => {
		expect(exitCodeForHttpError(code, status)).toBe(exit);
	});
});

describe("exitCodeForHttpError — HTTP status heuristic when code is unknown", () => {
	test.each([
		[undefined, 500, ExitCode.UNAVAILABLE],
		[undefined, 502, ExitCode.UNAVAILABLE],
		[undefined, 599, ExitCode.UNAVAILABLE],
		["completely_unknown_code", 503, ExitCode.UNAVAILABLE],
		[undefined, 404, ExitCode.NOT_FOUND],
		[undefined, 409, ExitCode.CONFLICT],
		[undefined, 401, ExitCode.AUTH_ERROR],
		[undefined, 403, ExitCode.AUTH_ERROR],
		[undefined, 400, ExitCode.RUNTIME_ERROR],
		[undefined, 422, ExitCode.RUNTIME_ERROR],
		[undefined, 200, ExitCode.OK],
		[undefined, 0, ExitCode.OK],
	])("code=%s status=%d → %s", (code, status, exit) => {
		expect(exitCodeForHttpError(code, status)).toBe(exit);
	});
});
