# IBM watsonx Agent Builder

> **Status: stub.** Connect tab renders the click-by-click recipe with your
> URLs pre-filled.

Watsonx Agent Builder is configured through its own web UI rather than
code. AI Workbench offers two paths in:

## Option A — Register as an MCP server (recommended)

1. In Agent Builder, open the agent and click
   **Tools → Add tool → MCP server**.
2. Fill in:
   - **Server URL**: `https://YOUR-WORKBENCH/api/v1/workspaces/YOUR-WORKSPACE-ID/mcp`
   - **Transport**: Streamable HTTP
   - **Auth header**: `Authorization: Bearer <your WORKBENCH_API_KEY>`
3. Save. The workspace's read tools (`search_kb`, `list_documents`,
   `list_knowledge_bases`) appear in the agent's tool list — toggle on
   the ones the agent should call.

Needs `mcp.enabled: true` on the runtime.

## Option B — Import the REST API as a custom tool

Works against any runtime, no MCP required.

1. Tools → Add tool → Custom tool → **From OpenAPI URL**.
2. **Source URL**: `https://YOUR-WORKBENCH/api/v1/openapi.json`
3. **Server URL**: `https://YOUR-WORKBENCH/api/v1`
4. **Auth**: API key, header name `Authorization`, value
   `Bearer <your WORKBENCH_API_KEY>`.
5. Builder generates one tool per operation. Hide the write operations
   you don't want the agent to invoke; keep the search / list ones.

## See also

- [`mcp.md`](../mcp.md)
- [watsonx Agent Builder docs](https://www.ibm.com/docs/en/watsonx/saas?topic=tools-adding)
