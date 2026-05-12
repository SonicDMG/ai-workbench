# Microsoft Agent Framework (MAF)

> **Status: stub.** Connect tab renders this snippet pre-filled.

## TL;DR (Python preview SDK)

```bash
pip install agent-framework
export WORKBENCH_API_KEY=wb_sk_...
export OPENAI_API_KEY=sk-...   # or AZURE_OPENAI_* for Azure
```

```python
import asyncio
import os

from agent_framework import ChatAgent
from agent_framework.mcp import MCPStreamableHTTPTool
from agent_framework.openai import OpenAIChatClient


async def main() -> None:
    async with MCPStreamableHTTPTool(
        name="workbench",
        url="https://YOUR-WORKBENCH/api/v1/workspaces/YOUR-WORKSPACE-ID/mcp",
        headers={"Authorization": f"Bearer {os.environ['WORKBENCH_API_KEY']}"},
    ) as workbench:
        agent = ChatAgent(
            chat_client=OpenAIChatClient(model_id="gpt-4o-mini"),
            tools=workbench,
            instructions="Ground every answer in the AI Workbench knowledge base.",
        )
        print((await agent.run("Summarize onboarding.")).text)


asyncio.run(main())
```

The matching .NET package (`Microsoft.Agents.AI`) ships an equivalent
`MCPClient`; the wire contract is identical, so the same workspace works
with either flavour.

## See also

- [MAF MCP integration docs](https://learn.microsoft.com/en-us/agent-framework/integrations/mcp)
- [`mcp.md`](../mcp.md)
