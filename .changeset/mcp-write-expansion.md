---
"@ai-workbench/cli": minor
---

Runtime: expand the MCP façade with three new write tools — `create_knowledge_base`, `delete_knowledge_base`, and `run_agent`. KB create/delete wrap the same `KnowledgeBaseService` the REST `/knowledge-bases` route uses, so collection provisioning and rollback semantics are identical across MCP and REST. `run_agent` is a one-call form of `chat_send` that resolves (or creates) a conversation bound to a stored agent and returns a structured envelope with the conversation id, finish reason, token count, and the retrieved-context chunk ids. KB writes require the `write` scope; `run_agent` follows `chat_send`'s `read`-passes convention since its mutations stay scoped to a single conversation.
