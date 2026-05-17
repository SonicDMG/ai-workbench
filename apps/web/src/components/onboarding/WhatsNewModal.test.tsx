import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WHATS_NEW_VERSION } from "@/lib/whats-new-content";
import { WhatsNewModal, WhatsNewTrigger } from "./WhatsNewModal";

const STORAGE_KEY = `aiw:wn:${WHATS_NEW_VERSION}`;

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	window.localStorage.clear();
});

describe("WhatsNewModal", () => {
	it("auto-opens on first mount when no dismissal stamp exists", async () => {
		render(<WhatsNewModal />);
		expect(
			await screen.findByText(`What's new in ${WHATS_NEW_VERSION}`),
		).toBeInTheDocument();
	});

	it("stays closed when localStorage already carries the dismissal stamp", () => {
		window.localStorage.setItem(STORAGE_KEY, "1");
		render(<WhatsNewModal />);
		expect(
			screen.queryByText(`What's new in ${WHATS_NEW_VERSION}`),
		).not.toBeInTheDocument();
	});

	it("persists the dismissal when the close button is clicked", async () => {
		const user = userEvent.setup();
		render(<WhatsNewModal />);
		const dialog = await screen.findByText(
			`What's new in ${WHATS_NEW_VERSION}`,
		);
		expect(dialog).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /got it/i }));

		expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
		expect(
			screen.queryByText(`What's new in ${WHATS_NEW_VERSION}`),
		).not.toBeInTheDocument();
	});

	it("re-opens on a custom-event dispatch from the header trigger", async () => {
		// Pre-dismiss so the modal isn't auto-open.
		window.localStorage.setItem(STORAGE_KEY, "1");
		const user = userEvent.setup();
		render(
			<>
				<WhatsNewTrigger />
				<WhatsNewModal />
			</>,
		);
		// Confirm closed initially.
		expect(
			screen.queryByText(`What's new in ${WHATS_NEW_VERSION}`),
		).not.toBeInTheDocument();

		await user.click(
			screen.getByRole("button", {
				name: new RegExp(`What's new in ${WHATS_NEW_VERSION}`, "i"),
			}),
		);

		expect(
			await screen.findByText(`What's new in ${WHATS_NEW_VERSION}`),
		).toBeInTheDocument();
	});
});
