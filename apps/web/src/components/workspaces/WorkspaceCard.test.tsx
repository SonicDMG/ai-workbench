import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/schemas";
import { WorkspaceCard } from "./WorkspaceCard";

const BASE_WORKSPACE: Workspace = {
	workspaceId: "00000000-0000-4000-8000-000000000001",
	name: "research-lab",
	kind: "astra",
	keyspace: "default_keyspace",
	url: "https://example-id.apps.astra.datastax.com",
	createdAt: "2026-04-01T00:00:00.000Z",
	updatedAt: "2026-04-02T00:00:00.000Z",
};

function renderCard(overrides: Partial<Workspace> = {}) {
	return render(
		<MemoryRouter>
			<WorkspaceCard workspace={{ ...BASE_WORKSPACE, ...overrides }} />
		</MemoryRouter>,
	);
}

describe("WorkspaceCard", () => {
	it("renders the workspace name, id, kind badge, keyspace, and url", () => {
		renderCard();

		expect(screen.getByText("research-lab")).toBeInTheDocument();
		expect(
			screen.getByText("00000000-0000-4000-8000-000000000001"),
		).toBeInTheDocument();
		expect(screen.getByText("default_keyspace")).toBeInTheDocument();
		expect(
			screen.getByText("https://example-id.apps.astra.datastax.com"),
		).toBeInTheDocument();
	});

	it("renders an em-dash placeholder when keyspace is null", () => {
		renderCard({ keyspace: null });
		expect(screen.getByText("—")).toBeInTheDocument();
	});

	it("hides the Url row when url is null", () => {
		renderCard({ url: null });
		expect(screen.queryByText("Url")).not.toBeInTheDocument();
	});

	it("links the whole card to the workspace detail route with an aria-label", () => {
		renderCard();
		const link = screen.getByRole("link", {
			name: "Open workspace research-lab",
		});
		expect(link).toHaveAttribute(
			"href",
			"/workspaces/00000000-0000-4000-8000-000000000001",
		);
	});
});
