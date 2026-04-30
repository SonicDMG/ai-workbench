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

	it("emits a payload with trimmed fields and null for blank credentialRef", async () => {
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		render(<LlmServiceForm mode="create" onSubmit={onSubmit} />);

		await user.type(screen.getByLabelText(/^Name/), "  prod-mistral  ");
		await user.type(
			screen.getByLabelText(/^Model/),
			"mistralai/Mistral-7B-Instruct-v0.3",
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
			maxOutputTokens: null,
		});
	});
});
