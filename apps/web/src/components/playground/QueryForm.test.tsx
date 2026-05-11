import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/authToken", () => ({
	getAuthToken: vi.fn(() => null),
}));

import { toast } from "sonner";
import { getAuthToken } from "@/lib/authToken";
import { QueryForm, type QueryFormTarget } from "./QueryForm";

const WS = "00000000-0000-4000-8000-000000000001";
const KB = "00000000-0000-4000-8000-000000000aaa";

function makeTarget(overrides: Partial<QueryFormTarget> = {}): QueryFormTarget {
	return {
		vectorDimension: 4,
		embeddingProvider: "mock:mock-embedder",
		lexicalSupported: false,
		rerankSupported: false,
		workspace: null,
		knowledgeBaseName: "test-kb",
		vectorCollection: null,
		...overrides,
	};
}

function renderForm(props: {
	target?: QueryFormTarget;
	onRun?: (input: unknown) => void;
	pending?: boolean;
}) {
	return render(
		<QueryForm
			target={props.target ?? makeTarget()}
			workspaceId={WS}
			knowledgeBaseId={KB}
			onRun={(props.onRun ?? (() => {})) as never}
			pending={props.pending ?? false}
		/>,
	);
}

afterEach(() => {
	vi.mocked(toast.success).mockReset();
	vi.mocked(toast.error).mockReset();
	vi.mocked(getAuthToken).mockReset();
	vi.mocked(getAuthToken).mockReturnValue(null);
});

describe("QueryForm", () => {
	it("submits a text query with a parsed filter", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		renderForm({ onRun });

		await user.type(screen.getByLabelText(/Query/), "blue sweater");
		fireEvent.change(screen.getByLabelText(/Filter/), {
			target: { value: '{"category": "apparel"}' },
		});
		await user.click(screen.getByRole("button", { name: /Run query/ }));

		expect(onRun).toHaveBeenCalledTimes(1);
		expect(onRun).toHaveBeenCalledWith({
			text: "blue sweater",
			topK: 10,
			filter: { category: "apparel" },
		});
	});

	it("rejects an empty text query inline without calling onRun", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		renderForm({ onRun });

		await user.click(screen.getByRole("button", { name: /Run query/ }));

		expect(onRun).not.toHaveBeenCalled();
		expect(screen.getByText(/text is required/i)).toBeInTheDocument();
	});

	it("opts hybrid into the request with a default lexical weight when toggled on", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		renderForm({ target: makeTarget({ lexicalSupported: true }), onRun });

		await user.type(screen.getByLabelText(/Query/), "anything");
		await user.click(screen.getByRole("checkbox", { name: /Hybrid/ }));
		await user.click(screen.getByRole("button", { name: /Run query/ }));

		expect(onRun).toHaveBeenCalledWith(
			expect.objectContaining({
				text: "anything",
				hybrid: true,
				lexicalWeight: 0.5,
			}),
		);
	});

	it("hides the lexical-weight slider until hybrid is on", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		renderForm({ target: makeTarget({ lexicalSupported: true }), onRun });

		expect(screen.queryByLabelText(/Lexical weight/i)).not.toBeInTheDocument();

		await user.click(screen.getByRole("checkbox", { name: /Hybrid/ }));

		expect(
			screen.getByLabelText(/Lexical weight \(0\.50\)/),
		).toBeInTheDocument();
	});

	it("forwards a custom lexical weight when the slider is dragged", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		renderForm({ target: makeTarget({ lexicalSupported: true }), onRun });

		await user.type(screen.getByLabelText(/Query/), "find me");
		await user.click(screen.getByRole("checkbox", { name: /Hybrid/ }));
		fireEvent.change(screen.getByLabelText(/Lexical weight/), {
			target: { value: "0.8" },
		});
		await user.click(screen.getByRole("button", { name: /Run query/ }));

		expect(onRun).toHaveBeenCalledWith(
			expect.objectContaining({ hybrid: true, lexicalWeight: 0.8 }),
		);
	});

	it("omits lexicalWeight when hybrid is off", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		renderForm({ target: makeTarget({ lexicalSupported: true }), onRun });

		await user.type(screen.getByLabelText(/Query/), "plain");
		await user.click(screen.getByRole("button", { name: /Run query/ }));

		const call = onRun.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(call.lexicalWeight).toBeUndefined();
		expect(call.hybrid).toBeUndefined();
	});

	it("blocks hybrid/rerank on the Vector tab with a clear message", async () => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		renderForm({ target: makeTarget({ lexicalSupported: true }), onRun });

		await user.click(screen.getByRole("button", { name: "Vector" }));
		fireEvent.change(screen.getByLabelText(/Vector \(/), {
			target: { value: "[0.1, 0.2, 0.3, 0.4]" },
		});
		await user.click(screen.getByRole("checkbox", { name: /Hybrid/ }));
		await user.click(screen.getByRole("button", { name: /Run query/ }));

		expect(onRun).not.toHaveBeenCalled();
		expect(
			screen.getByText(/hybrid and rerank require a text query/i),
		).toBeInTheDocument();
	});

	describe("Copy as cURL", () => {
		// userEvent.setup() installs its own in-memory `navigator.clipboard`
		// stub, so we can't override the property — instead we spy on
		// the writeText it provides. The spy is created per-test after
		// setup so each test starts from a clean call history.

		it("copies a cURL command that matches what Run would post", async () => {
			const user = userEvent.setup();
			const spy = vi
				.spyOn(navigator.clipboard, "writeText")
				.mockResolvedValue(undefined);
			renderForm({});

			await user.type(screen.getByLabelText(/Query/), "blue sweater");
			await user.click(screen.getByRole("button", { name: /Copy as cURL/ }));

			await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
			const command = spy.mock.calls[0]?.[0] as string;
			expect(command).toContain("curl -X POST");
			expect(command).toContain(
				`/api/v1/workspaces/${WS}/knowledge-bases/${KB}/search`,
			);
			expect(command).toContain("'Content-Type: application/json'");
			expect(command).toContain('"text":"blue sweater"');
			expect(command).toContain('"topK":10');
			expect(toast.success).toHaveBeenCalledWith(
				"Copied as cURL",
				expect.objectContaining({
					description: expect.stringMatching(/No bearer token/i),
				}),
			);
		});

		it("includes the bearer token when one is set", async () => {
			vi.mocked(getAuthToken).mockReturnValue("wb_test_token");
			const user = userEvent.setup();
			const spy = vi
				.spyOn(navigator.clipboard, "writeText")
				.mockResolvedValue(undefined);
			renderForm({});

			await user.type(screen.getByLabelText(/Query/), "anything");
			await user.click(screen.getByRole("button", { name: /Copy as cURL/ }));

			await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
			const command = spy.mock.calls[0]?.[0] as string;
			expect(command).toContain("'Authorization: Bearer wb_test_token'");
			expect(toast.success).toHaveBeenCalledWith(
				"Copied as cURL",
				expect.objectContaining({
					description: expect.stringMatching(/bearer token/i),
				}),
			);
		});

		it("does not copy when the form is invalid (e.g. empty text)", async () => {
			const user = userEvent.setup();
			const spy = vi
				.spyOn(navigator.clipboard, "writeText")
				.mockResolvedValue(undefined);
			renderForm({});

			// Empty Query → should refuse to copy and surface the same
			// inline error Run would.
			await user.click(screen.getByRole("button", { name: /Copy as cURL/ }));

			expect(spy).not.toHaveBeenCalled();
			expect(screen.getByText(/text is required/i)).toBeInTheDocument();
			expect(toast.success).not.toHaveBeenCalled();
		});

		it("toasts an error when the clipboard write rejects", async () => {
			const user = userEvent.setup();
			vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
				new Error("denied"),
			);
			renderForm({});

			await user.type(screen.getByLabelText(/Query/), "ok");
			await user.click(screen.getByRole("button", { name: /Copy as cURL/ }));

			await waitFor(() =>
				expect(toast.error).toHaveBeenCalledWith(
					"Couldn't copy to clipboard",
					expect.any(Object),
				),
			);
		});
	});
});
