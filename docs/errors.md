# Error codes

AI Workbench returns every error in a stable envelope:

```json
{
  "error": {
    "code": "workspace_not_found",
    "message": "workspace \"ws_123\" not found",
    "requestId": "01HY2Z...",
    "hint": "The workspace does not exist or your principal cannot see it; run `aiw workspace list` to verify.",
    "docs": "docs/errors.md#workspace-not-found"
  }
}
```

The `code` field is stable across releases. The table below maps
every registered code to its canonical HTTP status and remediation
hint; the long-form sections that follow are the canonical
destination for the envelope's `docs` field.

<!-- GENERATED FROM runtimes/typescript/src/lib/error-codes.ts —
     re-run `npm run docs:errors` after editing the registry. -->

## Index

| Code | Status | Hint |
|---|---|---|
| [`agent_not_found`](#agent-not-found) | 404 | The agent does not exist in this workspace; create one before sending messages. |
| [`agent_template_not_found`](#agent-template-not-found) | 404 | The agent template is not registered; pick one from `GET /api/v1/agent-templates`. |
| [`api_key_not_found`](#api-key-not-found) | 404 | The API key does not exist or was revoked. |
| [`cascade_incomplete`](#cascade-incomplete) | 500 | A workspace delete partially failed across Astra partitions; the workspace was left intact — retry the delete to complete the idempotent cascade. |
| [`chat_disabled`](#chat-disabled) | 503 | No chat provider is configured; uncomment the `chat` block in workbench.yaml or bind an LLM service to the agent. |
| [`chat_message_not_found`](#chat-message-not-found) | 404 | The chat message does not exist in this conversation. |
| [`chat_not_found`](#chat-not-found) | 404 | The chat thread does not exist for this workspace. |
| [`chunking_service_in_use`](#chunking-service-in-use) | 409 | At least one knowledge base binds this chunking service; rebind the KBs before deleting. |
| [`chunking_service_not_found`](#chunking-service-not-found) | 404 | The chunking service is not configured in this workspace. |
| [`collection_name_taken`](#collection-name-taken) | 409 | An Astra collection with this name already exists; choose another or adopt the existing one. |
| [`collection_not_found`](#collection-not-found) | 404 | The Astra collection does not exist; create it first or check the spelling. |
| [`collection_unavailable`](#collection-unavailable) | 503 | The Astra collection is temporarily unreachable; retry with backoff. |
| [`conflict`](#conflict) | 409 | The resource already exists or its state changed underneath you; refetch and retry. |
| [`control_plane_unavailable`](#control-plane-unavailable) | 503 | The control-plane backend is unreachable; verify Astra connectivity or the file driver path. |
| [`conversation_not_found`](#conversation-not-found) | 404 | The conversation does not exist for this agent; conversations are scoped per-agent. |
| [`data_api_error`](#data-api-error) | 502 | The Astra Data API returned an error; check Astra status and the runtime logs. |
| [`data_api_unavailable`](#data-api-unavailable) | 503 | The Astra Data API is unreachable or timed out; retry with backoff. |
| [`dimension_mismatch`](#dimension-mismatch) | 400 | The vector dimension does not match the collection's configured dimension. |
| [`document_not_found`](#document-not-found) | 404 | The document is not in this knowledge base; document IDs are scoped per-KB. |
| [`draining`](#draining) | 503 | The runtime is shutting down and is no longer accepting new requests; retry against another replica. |
| [`driver_unavailable`](#driver-unavailable) | 503 | The vector-store driver registered for this workspace failed to initialize. |
| [`embedding_dimension_mismatch`](#embedding-dimension-mismatch) | 400 | The embedding service returned a vector whose dimension does not match the collection. |
| [`embedding_service_in_use`](#embedding-service-in-use) | 409 | At least one knowledge base binds this embedding service; rebind the KBs before deleting. |
| [`embedding_service_not_found`](#embedding-service-not-found) | 404 | The embedding service is not configured in this workspace. |
| [`embedding_unavailable`](#embedding-unavailable) | 503 | The embedding provider is unreachable or rejected the request; check the service credentials. |
| [`empty_file`](#empty-file) | 400 | The uploaded file is zero bytes; check the source path before retrying. |
| [`forbidden`](#forbidden) | 403 | Your principal is authenticated but lacks the required scope or workspace access. |
| [`forbidden_origin`](#forbidden-origin) | 403 | The request Origin/Referer does not match the configured publicOrigin; check your reverse proxy. |
| [`hybrid_not_supported`](#hybrid-not-supported) | 501 | The active vector-store driver does not support hybrid (lexical+vector) search. |
| [`internal_error`](#internal-error) | 500 | An unexpected error occurred; check the runtime logs with the requestId for the full stack. |
| [`invalid_chunker`](#invalid-chunker) | 400 | The chunker name is not registered; valid chunkers are listed at `GET /api/v1/chunkers`. |
| [`invalid_cursor`](#invalid-cursor) | 400 | The pagination cursor is malformed or expired; restart pagination from the first page. |
| [`invalid_metadata`](#invalid-metadata) | 400 | The metadata object must be a shallow record of string-keyed JSON-safe values. |
| [`invalid_multipart`](#invalid-multipart) | 400 | The multipart/form-data body could not be parsed; check the Content-Type boundary. |
| [`invalid_parser`](#invalid-parser) | 400 | The parser name is not registered for this MIME type. |
| [`invalid_playground_command`](#invalid-playground-command) | 400 | The playground command name or argument shape is invalid; see /docs for the supported command list. |
| [`invalid_visible_to`](#invalid-visible-to) | 400 | The visibleTo field must be a non-empty array of principal IDs or '*'. |
| [`job_not_found`](#job-not-found) | 404 | The job ID does not exist or its retention window has elapsed. |
| [`kb_name_must_match_collection`](#kb-name-must-match-collection) | 400 | The KB name must equal the existing collection name when adopting an Astra collection. |
| [`kb_name_taken`](#kb-name-taken) | 409 | A knowledge base with this name already exists in the workspace; pick a unique name. |
| [`knowledge_base_not_found`](#knowledge-base-not-found) | 404 | The knowledge base does not exist in this workspace; run `aiw kb list --workspace <id>`. |
| [`knowledge_filter_not_found`](#knowledge-filter-not-found) | 404 | The knowledge filter is not defined in this workspace. |
| [`list_records_not_supported`](#list-records-not-supported) | 501 | This driver does not expose a list-records operation; use search instead. |
| [`llm_credential_missing`](#llm-credential-missing) | 503 | The LLM provider credential could not be resolved; check the credentialsRef on the service. |
| [`llm_model_not_chat`](#llm-model-not-chat) | 422 | The model is not served for chat completion; pick an instruct/chat model. |
| [`llm_model_unavailable`](#llm-model-unavailable) | 422 | The provider does not serve this model; check the model id (e.g. an OpenRouter slug like `openai/gpt-4o-mini`) and that your account/credits can route it. |
| [`llm_provider_unsupported`](#llm-provider-unsupported) | 422 | The agent's LLM service uses a provider this runtime cannot dispatch; choose openrouter, openai, or ollama (HuggingFace was removed in 0.3.0). |
| [`llm_service_in_use`](#llm-service-in-use) | 409 | At least one agent binds this LLM service; rebind the agents before deleting. |
| [`llm_service_not_found`](#llm-service-not-found) | 404 | The LLM service is not configured in this workspace. |
| [`missing_file`](#missing-file) | 400 | The request must include a `file` part in the multipart body. |
| [`not_found`](#not-found) | 404 | The route or resource does not exist; check the URL and the active workspace. |
| [`payload_too_large`](#payload-too-large) | 413 | Request body exceeded the per-route ceiling; split the payload or use the multipart ingest endpoint for large files. |
| [`policy_denied`](#policy-denied) | 403 | The active principal is not permitted to access this resource by the workspace's RLAC policy. |
| [`policy_principal_required`](#policy-principal-required) | 401 | This route requires a resolved sub-workspace principal; ensure your token carries the principal claim. |
| [`principal_not_found`](#principal-not-found) | 404 | The principal does not exist in this workspace's RLAC table. |
| [`rate_limited`](#rate-limited) | 429 | You hit the per-IP rate limit; back off and retry, or raise runtime.rateLimit.capacity. |
| [`rerank_not_supported`](#rerank-not-supported) | 501 | The active vector-store driver does not support reranking; set rerank=false. |
| [`reranking_service_in_use`](#reranking-service-in-use) | 409 | At least one knowledge base binds this reranking service; rebind the KBs before deleting. |
| [`reranking_service_not_found`](#reranking-service-not-found) | 404 | The reranking service is not configured in this workspace. |
| [`setup_restart_unavailable`](#setup-restart-unavailable) | 503 | This runtime did not register a restart hook; restart the container manually (`docker compose restart workbench`). |
| [`unauthorized`](#unauthorized) | 401 | Provide a valid API key or OIDC token via the Authorization header. |
| [`unsupported_workspace_kind`](#unsupported-workspace-kind) | 422 | This operation is not implemented for the workspace's backend kind. |
| [`validation_error`](#validation-error) | 400 | Request body or query string failed schema validation; see the message for the offending field. |
| [`vector_collection_not_allowed`](#vector-collection-not-allowed) | 400 | This operation targets a non-vector collection; remove the vector field from the request. |
| [`vector_collection_required`](#vector-collection-required) | 400 | This operation requires a vector-enabled collection; recreate it with a vector dimension. |
| [`vectorize_service_mismatch`](#vectorize-service-mismatch) | 400 | The KB's embedding service does not match the collection's $vectorize service definition. |
| [`workspace_database_conflict`](#workspace-database-conflict) | 409 | Another workspace is already bound to this (endpoint, keyspace); reuse it or pick a different keyspace. |
| [`workspace_misconfigured`](#workspace-misconfigured) | 422 | The workspace is missing required configuration (credentials, endpoint, or keyspace). |
| [`workspace_name_conflict`](#workspace-name-conflict) | 409 | A workspace with this name already exists; pick a unique name. |
| [`workspace_not_found`](#workspace-not-found) | 404 | The workspace does not exist or your principal cannot see it; run `aiw workspace list` to verify. |

---

## agent_not_found

- **Default status**: `404`
- **Hint**: The agent does not exist in this workspace; create one before sending messages.

## agent_template_not_found

- **Default status**: `404`
- **Hint**: The agent template is not registered; pick one from `GET /api/v1/agent-templates`.

## api_key_not_found

- **Default status**: `404`
- **Hint**: The API key does not exist or was revoked.

## cascade_incomplete

- **Default status**: `500`
- **Hint**: A workspace delete partially failed across Astra partitions; the workspace was left intact — retry the delete to complete the idempotent cascade.

## chat_disabled

- **Default status**: `503`
- **Hint**: No chat provider is configured; uncomment the `chat` block in workbench.yaml or bind an LLM service to the agent.

## chat_message_not_found

- **Default status**: `404`
- **Hint**: The chat message does not exist in this conversation.

## chat_not_found

- **Default status**: `404`
- **Hint**: The chat thread does not exist for this workspace.

## chunking_service_in_use

- **Default status**: `409`
- **Hint**: At least one knowledge base binds this chunking service; rebind the KBs before deleting.

## chunking_service_not_found

- **Default status**: `404`
- **Hint**: The chunking service is not configured in this workspace.

## collection_name_taken

- **Default status**: `409`
- **Hint**: An Astra collection with this name already exists; choose another or adopt the existing one.

## collection_not_found

- **Default status**: `404`
- **Hint**: The Astra collection does not exist; create it first or check the spelling.

## collection_unavailable

- **Default status**: `503`
- **Hint**: The Astra collection is temporarily unreachable; retry with backoff.

## conflict

- **Default status**: `409`
- **Hint**: The resource already exists or its state changed underneath you; refetch and retry.

## control_plane_unavailable

- **Default status**: `503`
- **Hint**: The control-plane backend is unreachable; verify Astra connectivity or the file driver path.

## conversation_not_found

- **Default status**: `404`
- **Hint**: The conversation does not exist for this agent; conversations are scoped per-agent.

## data_api_error

- **Default status**: `502`
- **Hint**: The Astra Data API returned an error; check Astra status and the runtime logs.

## data_api_unavailable

- **Default status**: `503`
- **Hint**: The Astra Data API is unreachable or timed out; retry with backoff.

## dimension_mismatch

- **Default status**: `400`
- **Hint**: The vector dimension does not match the collection's configured dimension.

## document_not_found

- **Default status**: `404`
- **Hint**: The document is not in this knowledge base; document IDs are scoped per-KB.

## draining

- **Default status**: `503`
- **Hint**: The runtime is shutting down and is no longer accepting new requests; retry against another replica.

## driver_unavailable

- **Default status**: `503`
- **Hint**: The vector-store driver registered for this workspace failed to initialize.

## embedding_dimension_mismatch

- **Default status**: `400`
- **Hint**: The embedding service returned a vector whose dimension does not match the collection.

## embedding_service_in_use

- **Default status**: `409`
- **Hint**: At least one knowledge base binds this embedding service; rebind the KBs before deleting.

## embedding_service_not_found

- **Default status**: `404`
- **Hint**: The embedding service is not configured in this workspace.

## embedding_unavailable

- **Default status**: `503`
- **Hint**: The embedding provider is unreachable or rejected the request; check the service credentials.

## empty_file

- **Default status**: `400`
- **Hint**: The uploaded file is zero bytes; check the source path before retrying.

## forbidden

- **Default status**: `403`
- **Hint**: Your principal is authenticated but lacks the required scope or workspace access.

## forbidden_origin

- **Default status**: `403`
- **Hint**: The request Origin/Referer does not match the configured publicOrigin; check your reverse proxy.

## hybrid_not_supported

- **Default status**: `501`
- **Hint**: The active vector-store driver does not support hybrid (lexical+vector) search.

## internal_error

- **Default status**: `500`
- **Hint**: An unexpected error occurred; check the runtime logs with the requestId for the full stack.

## invalid_chunker

- **Default status**: `400`
- **Hint**: The chunker name is not registered; valid chunkers are listed at `GET /api/v1/chunkers`.

## invalid_cursor

- **Default status**: `400`
- **Hint**: The pagination cursor is malformed or expired; restart pagination from the first page.

## invalid_metadata

- **Default status**: `400`
- **Hint**: The metadata object must be a shallow record of string-keyed JSON-safe values.

## invalid_multipart

- **Default status**: `400`
- **Hint**: The multipart/form-data body could not be parsed; check the Content-Type boundary.

## invalid_parser

- **Default status**: `400`
- **Hint**: The parser name is not registered for this MIME type.

## invalid_playground_command

- **Default status**: `400`
- **Hint**: The playground command name or argument shape is invalid; see /docs for the supported command list.

## invalid_visible_to

- **Default status**: `400`
- **Hint**: The visibleTo field must be a non-empty array of principal IDs or '*'.

## job_not_found

- **Default status**: `404`
- **Hint**: The job ID does not exist or its retention window has elapsed.

## kb_name_must_match_collection

- **Default status**: `400`
- **Hint**: The KB name must equal the existing collection name when adopting an Astra collection.

## kb_name_taken

- **Default status**: `409`
- **Hint**: A knowledge base with this name already exists in the workspace; pick a unique name.

## knowledge_base_not_found

- **Default status**: `404`
- **Hint**: The knowledge base does not exist in this workspace; run `aiw kb list --workspace <id>`.

## knowledge_filter_not_found

- **Default status**: `404`
- **Hint**: The knowledge filter is not defined in this workspace.

## list_records_not_supported

- **Default status**: `501`
- **Hint**: This driver does not expose a list-records operation; use search instead.

## llm_credential_missing

- **Default status**: `503`
- **Hint**: The LLM provider credential could not be resolved; check the credentialsRef on the service.

## llm_model_not_chat

- **Default status**: `422`
- **Hint**: The model is not served for chat completion; pick an instruct/chat model.

## llm_model_unavailable

- **Default status**: `422`
- **Hint**: The provider does not serve this model; check the model id (e.g. an OpenRouter slug like `openai/gpt-4o-mini`) and that your account/credits can route it.

## llm_provider_unsupported

- **Default status**: `422`
- **Hint**: The agent's LLM service uses a provider this runtime cannot dispatch; choose openrouter, openai, or ollama (HuggingFace was removed in 0.3.0).

## llm_service_in_use

- **Default status**: `409`
- **Hint**: At least one agent binds this LLM service; rebind the agents before deleting.

## llm_service_not_found

- **Default status**: `404`
- **Hint**: The LLM service is not configured in this workspace.

## missing_file

- **Default status**: `400`
- **Hint**: The request must include a `file` part in the multipart body.

## not_found

- **Default status**: `404`
- **Hint**: The route or resource does not exist; check the URL and the active workspace.

## payload_too_large

- **Default status**: `413`
- **Hint**: Request body exceeded the per-route ceiling; split the payload or use the multipart ingest endpoint for large files.

## policy_denied

- **Default status**: `403`
- **Hint**: The active principal is not permitted to access this resource by the workspace's RLAC policy.

## policy_principal_required

- **Default status**: `401`
- **Hint**: This route requires a resolved sub-workspace principal; ensure your token carries the principal claim.

## principal_not_found

- **Default status**: `404`
- **Hint**: The principal does not exist in this workspace's RLAC table.

## rate_limited

- **Default status**: `429`
- **Hint**: You hit the per-IP rate limit; back off and retry, or raise runtime.rateLimit.capacity.

## rerank_not_supported

- **Default status**: `501`
- **Hint**: The active vector-store driver does not support reranking; set rerank=false.

## reranking_service_in_use

- **Default status**: `409`
- **Hint**: At least one knowledge base binds this reranking service; rebind the KBs before deleting.

## reranking_service_not_found

- **Default status**: `404`
- **Hint**: The reranking service is not configured in this workspace.

## setup_restart_unavailable

- **Default status**: `503`
- **Hint**: This runtime did not register a restart hook; restart the container manually (`docker compose restart workbench`).

## unauthorized

- **Default status**: `401`
- **Hint**: Provide a valid API key or OIDC token via the Authorization header.

## unsupported_workspace_kind

- **Default status**: `422`
- **Hint**: This operation is not implemented for the workspace's backend kind.

## validation_error

- **Default status**: `400`
- **Hint**: Request body or query string failed schema validation; see the message for the offending field.

## vector_collection_not_allowed

- **Default status**: `400`
- **Hint**: This operation targets a non-vector collection; remove the vector field from the request.

## vector_collection_required

- **Default status**: `400`
- **Hint**: This operation requires a vector-enabled collection; recreate it with a vector dimension.

## vectorize_service_mismatch

- **Default status**: `400`
- **Hint**: The KB's embedding service does not match the collection's $vectorize service definition.

## workspace_database_conflict

- **Default status**: `409`
- **Hint**: Another workspace is already bound to this (endpoint, keyspace); reuse it or pick a different keyspace.

## workspace_misconfigured

- **Default status**: `422`
- **Hint**: The workspace is missing required configuration (credentials, endpoint, or keyspace).

## workspace_name_conflict

- **Default status**: `409`
- **Hint**: A workspace with this name already exists; pick a unique name.

## workspace_not_found

- **Default status**: `404`
- **Hint**: The workspace does not exist or your principal cannot see it; run `aiw workspace list` to verify.

