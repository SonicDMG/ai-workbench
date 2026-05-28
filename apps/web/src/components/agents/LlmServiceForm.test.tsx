import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LlmServiceForm } from "./LlmServiceForm";

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

		await user.type(screen.getByLabelText(/^Name/), "  prod-mistral  ");

		// Open the Model picker and choose the default Mistral row.
		await user.click(screen.getByRole("combobox", { name: /^Model/ }));
		await user.click(
			await screen.findByRole("option", {
				name: /Mistral-7B-Instruct v0\.3 \(default\)/,
			}),
		);

		await user.click(
			screen.getByRole("button", { name: /Create LLM service/ }),
		);

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit).toHaveBeenCalledWith({
			name: "prod-mistral",
			description: null,
			provider: "huggingface",
			modelName: "mistralai/Mistral-7B-Instruct-v0.3",
			credentialRef: null,
			maxOutputTokens: 1024,
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
			// Provider stays at the default (huggingface) — Other doesn't
			// force a provider, the operator can change it independently.
			provider: "huggingface",
			modelName: "my-org/my-fine-tune:v1",
			credentialRef: null,
			maxOutputTokens: null,
		});
	});

	it("edit mode with a non-popular model name shows the free-form input pre-filled", async () => {
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		render(
			<LlmServiceForm
				mode="edit"
				onSubmit={onSubmit}
				service={{
					workspaceId: "00000000-0000-4000-8000-000000000001",
					llmServiceId: "00000000-0000-4000-8000-aaaaaaaaaaaa",
					name: "legacy",
					description: null,
					status: "active",
					provider: "huggingface",
					engine: null,
					modelName: "obscure-org/legacy-llm",
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

		// Free-form input renders and carries the legacy model name.
		const customInput = await screen.findByLabelText(/Custom model name/);
		expect(customInput).toHaveValue("obscure-org/legacy-llm");
	});
});
