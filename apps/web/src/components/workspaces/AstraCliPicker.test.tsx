/**
 * AstraCliPicker behaviour:
 *  - renders nothing when the inventory reports unavailable
 *  - on first render with the inventory available, auto-selects the
 *    profile flagged `isUsedAsDefault` (or the first profile with at
 *    least one database)
 *  - emits a fresh selection when the user changes profile / database
 *  - never displays the literal string "token" in raw form (the
 *    summary line shows the ref shape but no actual secret material)
 */

import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AstraCliInventory, AstraCliProfileEntry } from "@/lib/schemas";
import { AstraCliPicker, type AstraCliSelection } from "./AstraCliPicker";

function profile(
	overrides: Partial<AstraCliProfileEntry> = {},
): AstraCliProfileEntry {
	return {
		name: "alpha",
		env: "PROD",
		isUsedAsDefault: false,
		databases: [],
		...overrides,
	};
}

const inventoryAvailable: AstraCliInventory = {
	available: true,
	profiles: [
		profile({
			name: "alpha",
			isUsedAsDefault: true,
			databases: [
				{
					id: "11111111-1111-1111-1111-111111111111",
					name: "alpha-db",
					region: "us-east-2",
					endpoint:
						"https://11111111-1111-1111-1111-111111111111-us-east-2.apps.astra.datastax.com",
					keyspace: "default_keyspace",
				},
			],
		}),
		profile({
			name: "beta",
			databases: [
				{
					id: "22222222-2222-2222-2222-222222222222",
					name: "beta-db",
					region: "us-west-2",
					endpoint:
						"https://22222222-2222-2222-2222-222222222222-us-west-2.apps.astra.datastax.com",
					keyspace: null,
				},
			],
		}),
	],
};

function ControlledPicker({
	inventory,
	onSelectionRef,
}: {
	inventory: AstraCliInventory;
	onSelectionRef?: (sel: AstraCliSelection | null) => void;
}) {
	const [value, setValue] = useState<AstraCliSelection | null>(null);
	return (
		<AstraCliPicker
			inventory={inventory}
			value={value}
			onChange={(next) => {
				setValue(next);
				onSelectionRef?.(next);
			}}
		/>
	);
}

describe("AstraCliPicker", () => {
	it("renders nothing when the inventory is unavailable", () => {
		const { container } = render(
			<AstraCliPicker
				inventory={{ available: false, reason: "binary-not-found" }}
				value={null}
				onChange={vi.fn()}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders the picker shell + profile/database selects when available", () => {
		render(<ControlledPicker inventory={inventoryAvailable} />);
		expect(screen.getByTestId("astra-cli-picker")).toBeInTheDocument();
		expect(screen.getByTestId("astra-cli-picker-profile")).toBeInTheDocument();
		expect(screen.getByTestId("astra-cli-picker-database")).toBeInTheDocument();
	});

	it("auto-selects the default profile + its first database on first render", () => {
		const onSelection = vi.fn();
		render(
			<ControlledPicker
				inventory={inventoryAvailable}
				onSelectionRef={onSelection}
			/>,
		);
		// First call: auto-select the default-flagged profile.
		expect(onSelection).toHaveBeenCalledWith({
			profile: "alpha",
			database: expect.objectContaining({
				id: "11111111-1111-1111-1111-111111111111",
				name: "alpha-db",
			}),
		});
	});

	it("renders an empty container with no profiles", () => {
		const { container } = render(
			<AstraCliPicker
				inventory={{ available: true, profiles: [] }}
				value={null}
				onChange={vi.fn()}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});

	it("never includes the literal token shape in the summary", () => {
		render(<ControlledPicker inventory={inventoryAvailable} />);
		// Summary advertises the ref shape (no real secret value).
		const summary = screen.getByTestId("astra-cli-picker-summary");
		expect(summary.textContent).toContain("astra-cli:alpha:");
		expect(summary.textContent).not.toContain("AstraCS:");
	});
});
