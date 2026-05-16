<!-- Generated: 2026-05-16 | Token estimate: ~800 -->

# Data Codemap

## Control-plane store (`src/control-plane/store.ts`)

Three pluggable backends, same interface:

| Backend | Path | Use |
|---|---|---|
| **Memory** | `control-plane/memory/store.ts` | CI, demos, ephemeral dev |
| **File** | `control-plane/file/store.ts` | Single-node self-host (JSON + atomic rename) |
| **Astra** | `control-plane/astra/store.ts` | Production (DataStax Astra) |

Backend is selected by `workbench.yaml` config; see [configuration.md](../configuration.md).

## Astra tables (`src/astra-client/table-definitions.ts`)

All tables prefixed `wb_`.

### Config plane

| Table | Holds |
|---|---|
| `wb_config_workspaces` | Workspaces |
| `wb_api_key_by_workspace` | API keys (workspace partition) |
| `wb_api_key_lookup` | Lookup table for key → workspace |
| `wb_config_knowledge_bases_by_workspace` | KBs |
| `wb_config_knowledge_filters_by_kb` | Saved KB filters |
| `wb_config_chunking_service_by_workspace` | Chunker configs |
| `wb_config_embedding_service_by_workspace` | Embedder configs |
| `wb_config_reranking_service_by_workspace` | Reranker configs |
| `wb_config_llm_service_by_workspace` | LLM service configs |
| `wb_config_mcp_tools_by_workspace` | MCP tool registry |

### Document plane

| Table | Holds |
|---|---|
| `wb_rag_documents_by_knowledge_base` | Documents (primary index) |
| `wb_rag_documents_by_status` | Documents by ingest status |
| `wb_rag_documents_by_content_hash` | Dedup by SHA-256 |

### Agentic plane

| Table | Holds |
|---|---|
| `wb_agentic_agents_by_workspace` | Agents |
| `wb_agentic_conversations_by_agent` | Conversations |
| `wb_agentic_messages_by_conversation` | Chat messages |

### RLAC plane (prototype)

| Table | Holds |
|---|---|
| `wb_principals_by_workspace` | RLAC principals |
| `wb_policy_audit_by_workspace` | Audit log of policy evaluations |

### Jobs

| Table | Holds |
|---|---|
| `wb_jobs_by_workspace` | Durable job records (ingest, cascading delete) |

## Aggregate → repo → table mapping

```
Workspace        → WorkspaceRepo        → wb_config_workspaces
KnowledgeBase    → KnowledgeBaseRepo    → wb_config_knowledge_bases_by_workspace
RagDocument      → RagDocumentRepo      → wb_rag_documents_by_*  (3 indexes)
Agent            → AgentRepo            → wb_agentic_agents_by_workspace
Conversation     → ConversationRepo     → wb_agentic_conversations_by_agent
ChatMessage      → ChatMessageRepo      → wb_agentic_messages_by_conversation
ApiKey           → ApiKeyRepo           → wb_api_key_*           (2 tables)
Principal        → PrincipalRepo        → wb_principals_by_workspace
PolicyAudit      → PolicyAuditRepo      → wb_policy_audit_by_workspace
ChunkingService  → ChunkingServiceRepo  → wb_config_chunking_service_by_workspace
EmbeddingService → EmbeddingServiceRepo → wb_config_embedding_service_by_workspace
RerankingService → RerankingServiceRepo → wb_config_reranking_service_by_workspace
LlmService       → LlmServiceRepo       → wb_config_llm_service_by_workspace
KnowledgeFilter  → KnowledgeFilterRepo  → wb_config_knowledge_filters_by_kb
```

## Wire format

- **Astra rows:** snake_case (`source_filename`, `ingested_at`).
- **App models:** camelCase (`sourceFilename`, `ingestedAt`).
- **Adapters:** `src/astra-client/row-types.ts` and per-repo `toRow`/`fromRow` helpers.

## Migrations

No explicit migration tool — schemas live in `table-definitions.ts`. The Astra client creates missing tables at startup (idempotent). Schema changes require:

1. Edit `table-definitions.ts`.
2. Provide an adapter that handles both old and new shapes during rollout.
3. Bump `version.ts` if it's a breaking wire change.

No down-migrations.

## RLAC data model

- **Document fields:** `visibleTo: string[] | null` (principal IDs), `ownerPrincipalId: string | null`.
- **Principal:** `{ id, workspaceId, externalId, scopes }`.
- **Policy:** expressions parsed → AST → compiled to Astra filter at query time.
- **Audit:** every enforcement decision logged to `wb_policy_audit_by_workspace`.

## See also

- [../audit.md](../audit.md) — audit event reference (16 actions)
- [../architecture.md](../architecture.md) — long-form storage discussion
- [../adr/0002-per-aggregate-repos.md](../adr/) — why repos are split
