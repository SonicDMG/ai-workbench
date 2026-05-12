# Raw MCP smoke test (curl)

> **Status: stub.** Connect tab renders this one too.

A one-line `curl` against the workspace's MCP endpoint. If this 200s,
every framework recipe in the catalog will work — the smoke test is the
fastest way to prove a workspace is reachable from outside before
reaching for any SDK.

## Tools list

```bash
export WORKBENCH_API_KEY=wb_sk_...

curl -sN 'https://YOUR-WORKBENCH/api/v1/workspaces/YOUR-WORKSPACE-ID/mcp' \
  -H "Authorization: Bearer $WORKBENCH_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expect a JSON-RPC response listing `search_kb`, `list_knowledge_bases`,
`list_documents`, `list_chats`, `list_chat_messages`, and `chat_send` if
`mcp.exposeChat: true` is set.

## Call a tool

```bash
curl -sN 'https://YOUR-WORKBENCH/api/v1/workspaces/YOUR-WORKSPACE-ID/mcp' \
  -H "Authorization: Bearer $WORKBENCH_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
        "name":"list_knowledge_bases","arguments":{}
      }}'
```

## See also

- [`mcp.md`](../mcp.md) — the underlying façade.
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
