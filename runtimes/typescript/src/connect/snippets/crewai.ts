/**
 * CrewAI (Python) — MCP transport via `crewai-tools`' MCPServerAdapter.
 *
 * CrewAI's mental model is roles + tasks composed into a Crew; the
 * `MCPServerAdapter` lets every agent in the crew share the same MCP
 * tool surface. We model a single Researcher agent here to keep the
 * sample minimal — the user expands to multi-agent crews in their own
 * code.
 */

import type { ConnectSnippet, SnippetContext } from "../types.js";
import { mcpUrl } from "./urls.js";

export function buildCrewAiSnippet(ctx: SnippetContext): ConnectSnippet {
	const url = mcpUrl(ctx.publicBaseUrl, ctx.workspaceId);
	const code = `# Install: pip install 'crewai[tools]'
# Env:     export ${ctx.apiKeyEnvVar}=wb_sk_...
#          export OPENAI_API_KEY=sk-...

import os

from crewai import Agent, Crew, Task
from crewai_tools import MCPServerAdapter

server_params = {
    "url": "${url}",
    "transport": "streamable-http",
    "headers": {
        "Authorization": f"Bearer {os.environ['${ctx.apiKeyEnvVar}']}",
    },
}

with MCPServerAdapter(server_params) as workbench_tools:
    researcher = Agent(
        role="Knowledge-base researcher",
        goal="Answer the user's question using AI Workbench retrieval.",
        backstory="You ground every claim in the workspace's knowledge bases.",
        tools=workbench_tools,
    )

    task = Task(
        description="Summarize how onboarding works, using the KB as source.",
        expected_output="A 3-sentence summary citing the KB.",
        agent=researcher,
    )

    crew = Crew(agents=[researcher], tasks=[task])
    print(crew.kickoff())
`;
	return {
		id: "crewai",
		displayName: "CrewAI",
		tagline:
			"Share AI Workbench retrieval across every agent in a Crew via MCPServerAdapter.",
		language: "python",
		transport: "mcp",
		install: "pip install 'crewai[tools]'",
		code,
		requiresMcp: true,
		docsUrl: "https://docs.crewai.com/en/mcp/overview",
		notes:
			"`crewai-tools` >= 0.34 ships MCPServerAdapter with Streamable HTTP. Older versions only support stdio.",
	};
}
