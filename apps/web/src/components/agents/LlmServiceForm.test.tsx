import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmModelList } from "@/lib/schemas";
import { LlmServiceForm } from "./LlmServiceForm";

// The form pulls its model picker from `useLlmModels` (react-query).
// Mock the hook so the component renders without a QueryClientProvider
// and we control the live-vs-fallback catalog per test. `data:
// undefined` exercises the curated static fallback the form falls back
// to while the query is pending or offline.
const { modelsState } = vi.hoisted(() => ({
	modelsState: { data: undefined as LlmModelList | undefined },
}));
vi.mock("@/hooks/useConversations", () => ({
	useLlmModels: () => modelsState,
}));

beforeEach(() => {
	modelsState.data = undefined;
});

describe("LlmServiceForm", () => {
	it("blocks submit when name and model are blank", async () => {
		const onSubmit = vi.fn();
		const user = userEvent.setup();
		render(<LlmServiceForm mode="create" onSubmit={onSubmit} />);

		await user.click(
			screen.getByRole("button", { name: /Create LLM service/ }),
		);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(await screen.findByText("Name is required")).toBeInTheDocument();
		expect(screen.getByText("Model is required")).toBeInTheDocument();
	});

	it("picking a popular model fills modelName + provider + sensible maxOutputTokens", async () => {
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		render(<LlmServiceForm mode="create" onSubmit={onSubmit} />);

		await user.type(screen.getByLabelText(/^Name/), "  prod-gpt-4o  ");

		// Open the Model picker and choose the default GPT-4o mini row.
		await user.click(screen.getByRole("combobox", { name: /^Model/ }));
		await user.click(
			await screen.findByRole("option", {
				name: /GPT-4o mini \(default\)/,
			}),
		);

		await user.click(
			screen.getByRole("button", { name: /Create LLM service/ }),
		);

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit).toHaveBeenCalledWith({
			name: "prod-gpt-4o",
			description: null,
			provider: "openrouter",
			modelName: "openai/gpt-4o-mini",
			credentialRef: null,
			endpointBaseUrl: null,
			maxOutputTokens: 1024,
		});
	});

	it("submits a custom endpoint base URL when one is typed (#361)", async () => {
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		render(<LlmServiceForm mode="create" onSubmit={onSubmit} />);

		await user.type(screen.getByLabelText(/^Name/), "docker-ollama");

		// The model picker is provider-scoped, so switch to Ollama first.
		await user.click(screen.getByRole("combobox", { name: /^Provider/ }));
		await user.click(
			await screen.findByRole("option", { name: /Ollama — local\/offline/ }),
		);

		await user.click(screen.getByRole("combobox", { name: /^Model/ }));
		await user.click(
			await screen.findByRole("option", { name: /Llama 3.1 \(local Ollama\)/ }),
		);

		await user.type(
			screen.getByLabelText(/Endpoint base URL/),
			"http://host.docker.internal:11434/v1",
		);

		await user.click(
			screen.getByRole("button", { name: /Create LLM service/ }),
		);

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit).toHaveBeenCalledWith({
			name: "docker-ollama",
			description: null,
			provider: "ollama",
			modelName: "llama3.1",
			credentialRef: null,
			endpointBaseUrl: "http://host.docker.internal:11434/v1",
			maxOutputTokens: 2048,
		});
	});

	it("Other (custom) reveals a free-form input and submits whatever was typed", async () => {
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		render(<LlmServiceForm mode="create" onSubmit={onSubmit} />);

		await user.type(screen.getByLabelText(/^Name/), "custom-llama");

		await user.click(screen.getByRole("combobox", { name: /^Model/ }));
		await user.click(
			await screen.findByRole("option", { name: /Other \(custom\)/ }),
		);

		// The free-form input is now visible via its aria-label.
		await user.type(
			await screen.findByLabelText(/Custom model name/),
			"my-org/my-fine-tune:v1",
		);

		await user.click(
			screen.getByRole("button", { name: /Create LLM service/ }),
		);

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit).toHaveBeenCalledWith({
			name: "custom-llama",
			description: null,
			// Provider stays at the default (openrouter) — Other doesn't
			// force a provider, the operator can change it independently.
			provider: "openrouter",
			modelName: "my-org/my-fine-tune:v1",
			credentialRef: null,
			endpointBaseUrl: null,
			maxOutputTokens: null,
		});
	});

	it("edit mode keeps a saved model selected instead of collapsing into Other", async () => {
		// The user's reported bug: a real OpenRouter model that isn't in the
		// curated static fallback used to reopen in the free-form "Other"
		// input instead of staying selected. It must now stay a selected
		// option (the catalog is empty here — query data is undefined — so
		// only the synthesized current-model option can keep it selected).
		const user = userEvent.setup();
		render(
			<LlmServiceForm
				mode="edit"
				onSubmit={vi.fn()}
				service={{
					workspaceId: "00000000-0000-4000-8000-000000000001",
					llmServiceId: "00000000-0000-4000-8000-aaaaaaaaaaaa",
					name: "claude",
					description: null,
					status: "active",
					provider: "openrouter",
					engine: null,
					modelName: "anthropic/claude-sonnet-latest",
					modelVersion: null,
					contextWindowTokens: null,
					maxOutputTokens: null,
					temperatureMin: null,
					temperatureMax: null,
					supportsStreaming: null,
					supportsTools: null,
					endpointBaseUrl: null,
					endpointPath: null,
					requestTimeoutMs: null,
					maxBatchSize: null,
					authType: "none",
					credentialRef: null,
					supportedLanguages: [],
					supportedContent: [],
					createdAt: "2026-05-27T00:00:00.000Z",
					updatedAt: "2026-05-27T00:00:00.000Z",
				}}
			/>,
		);

		// Not collapsed into the free-form "Other" input…
		expect(
			screen.queryByLabelText(/Custom model name/),
		).not.toBeInTheDocument();
		// …the closed trigger shows the saved model as the current
		// selection (not a blank/placeholder)…
		expect(screen.getByRole("combobox", { name: /^Model/ })).toHaveTextContent(
			"anthropic/claude-sonnet-latest",
		);
		// …and the saved id is a selectable option, carried verbatim (no
		// decorating glyph leaks into the value).
		await user.click(screen.getByRole("combobox", { name: /^Model/ }));
		expect(
			await screen.findByRole("option", {
				name: "anthropic/claude-sonnet-latest",
			}),
		).toBeInTheDocument();
	});

	it("picking 'Other (custom)' reveals the free-form input in edit mode", async () => {
		const user = userEvent.setup();
		render(
			<LlmServiceForm
				mode="edit"
				onSubmit={vi.fn()}
				service={{
					workspaceId: "00000000-0000-4000-8000-000000000001",
					llmServiceId: "00000000-0000-4000-8000-aaaaaaaaaaaa",
					name: "claude",
					description: null,
					status: "active",
					provider: "openrouter",
					engine: null,
					modelName: "anthropic/claude-sonnet-latest",
					modelVersion: null,
					contextWindowTokens: null,
					maxOutputTokens: null,
					temperatureMin: null,
					temperatureMax: null,
					supportsStreaming: null,
					supportsTools: null,
					endpointBaseUrl: null,
					endpointPath: null,
					requestTimeoutMs: null,
					maxBatchSize: null,
					authType: "none",
					credentialRef: null,
					supportedLanguages: [],
					supportedContent: [],
					createdAt: "2026-05-27T00:00:00.000Z",
					updatedAt: "2026-05-27T00:00:00.000Z",
				}}
			/>,
		);

		expect(
			screen.queryByLabelText(/Custom model name/),
		).not.toBeInTheDocument();
		await user.click(screen.getByRole("combobox", { name: /^Model/ }));
		await user.click(
			await screen.findByRole("option", { name: /Other \(custom\)/ }),
		);
		expect(
			await screen.findByLabelText(/Custom model name/),
		).toBeInTheDocument();
	});

	it("drives the picker from the live catalog and selects a live-only model", async () => {
		// A model that isn't in the curated static list — only reachable
		// because the live OpenRouter catalog surfaced it.
		modelsState.data = {
			provider: "openrouter",
			source: "live",
			models: [
				{
					id: "qwen/qwen-2.5-72b-instruct",
					name: "Qwen2.5 72B Instruct",
					supportsTools: true,
					recommended: true,
				},
			],
		};
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		render(<LlmServiceForm mode="create" onSubmit={onSubmit} />);

		await user.type(screen.getByLabelText(/^Name/), "live-qwen");

		await user.click(screen.getByRole("combobox", { name: /^Model/ }));
		// Recommended live models sit under a "Recommended" group with clean
		// labels — no decorating glyph that could leak into the saved value.
		await user.click(
			await screen.findByRole("option", { name: "Qwen2.5 72B Instruct" }),
		);

		await user.click(
			screen.getByRole("button", { name: /Create LLM service/ }),
		);

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit).toHaveBeenCalledWith({
			name: "live-qwen",
			description: null,
			provider: "openrouter",
			modelName: "qwen/qwen-2.5-72b-instruct",
			credentialRef: null,
			endpointBaseUrl: null,
			// Live catalog entries carry no curated default cap.
			maxOutputTokens: null,
		});
	});
});
