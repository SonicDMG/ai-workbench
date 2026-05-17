import { expect, test } from "./_fixtures";

// Chat page (apps/web/src/pages/ChatPage.tsx) E2E coverage.
//
// Scope: the surfaces operators touch BEFORE a model is involved —
// agent picker, conversation create, sidebar row, ConversationThread
// composer. We deliberately stop short of submitting a message: the
// memory backend has no `chat:` block in `workbench.memory.yaml`, so
// the auto-seeded `openai-gpt-4o-mini` LLM service requires an
// `OPENAI_API_KEY` env var that CI doesn't set. Hitting `/messages`
// would either 503 on CI or actually fan out to OpenAI in dev. The
// conversation create endpoint, the SSE wiring, and the
// `useSendConversationStream` happy path are unit-tested at the
// runtime + hook layer; the gap that needed an E2E pin is the
// orchestration the page does around route params, agent selection,
// and the empty → live state transition.
//
// State does not persist between specs.

test("chat: pick agent, create conversation, land in the composer", async ({
	page,
	request,
}, testInfo) => {
	const wsRes = await request.post("/api/v1/workspaces", {
		data: {
			kind: "mock",
			name: `e2e-chat-${testInfo.workerIndex}-${Date.now()}`,
		},
	});
	expect(wsRes.ok(), `workspace create: ${await wsRes.text()}`).toBe(true);
	const workspaceId = (await wsRes.json()).workspaceId as string;

	await page.goto(`/workspaces/${workspaceId}/chat`);

	// Page chrome — heading + the descriptor paragraph that references
	// the workspace name. The page H1 is just "Chat"; the workspace
	// name renders inside the paragraph below it.
	await expect(
		page.getByRole("heading", { level: 1, name: "Chat" }),
	).toBeVisible();

	// Bobby + Maven are auto-seeded by the workspace POST. The agent
	// picker is a native <select> with accessible name "Agent" — the
	// active value renders as the visible option text.
	const agentPicker = page.getByRole("combobox", { name: "Agent" });
	await expect(agentPicker).toBeVisible();
	await expect(agentPicker).toHaveValue(/.+/); // some agent is picked

	// The active agent is Bobby (first alphabetically in the seeded
	// pair). EmptyConversationPane references the agent by name, so
	// the next-step button copy is stable.
	await expect(
		page.getByText(
			"Pick a conversation from the left, or start a new one with",
		),
	).toBeVisible();

	// Sidebar empty state pre-conversation.
	await expect(
		page.getByText("No conversations yet. Start one above."),
	).toBeVisible();

	// Click the empty-state CTA. The page mutates `?conversation=` into
	// the URL and remounts ConversationThread under the same agent.
	await page.getByRole("button", { name: /Start a conversation/ }).click();

	await expect(page).toHaveURL(
		/\?agent=[0-9a-f-]{36}&conversation=[0-9a-f-]{36}/,
	);

	// ConversationThread mounts. We pin three landmarks the thread
	// owns: the empty-message hint, the composer form, and the Send
	// button. The composer placeholder includes the active agent name,
	// which we don't hardcode — `Ask <agent>… (Enter to send)`.
	await expect(page.getByText(/^No messages yet/)).toBeVisible();
	await expect(
		page.getByRole("form", { name: "Send a message" }),
	).toBeVisible();

	const composer = page.getByRole("textbox", { name: "Message" });
	await expect(composer).toBeVisible();
	await expect(composer).toHaveAttribute(
		"placeholder",
		/^Ask .+… \(Enter to send\)$/,
	);

	await expect(page.getByRole("button", { name: /^Send$/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /^Delete$/ })).toBeVisible();

	// The newly-created conversation also appears in the left rail.
	// ConversationSidebar renders one button per conversation; the
	// accessible name starts with the conversation title ("New
	// conversation"). Default title is "New conversation".
	await expect(
		page
			.getByRole("complementary", { name: "Conversations" })
			.getByRole("button", { name: /New conversation/ })
			.first(),
	).toBeVisible();
});
