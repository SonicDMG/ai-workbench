import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AstraCliInfo } from "@/lib/schemas";
import { AstraCliDetectionCard } from "./AstraCliDetectionCard";

const detected: AstraCliInfo = {
	detected: true,
	profile: "Eric Hare",
	database: {
		id: "c933e7fc-4996-4dcd-bb87-4f282fe1e7ef",
		name: "mydb",
		region: "us-east-2",
		endpoint:
			"https://c933e7fc-4996-4dcd-bb87-4f282fe1e7ef-us-east-2.apps.astra.datastax.com",
		keyspace: "default_keyspace",
	},
};

describe("AstraCliDetectionCard", () => {
	it("renders the resolved profile, database, region, endpoint, keyspace", () => {
		render(<AstraCliDetectionCard info={detected} />);
		expect(screen.getByTestId("astra-cli-detection-card")).toBeInTheDocument();
		expect(screen.getByText(/Astra CLI profile detected/i)).toBeInTheDocument();
		expect(screen.getByText(/"Eric Hare"/)).toBeInTheDocument();
		expect(screen.getByText("mydb")).toBeInTheDocument();
		expect(screen.getByText("us-east-2")).toBeInTheDocument();
		expect(
			screen.getByText(
				"https://c933e7fc-4996-4dcd-bb87-4f282fe1e7ef-us-east-2.apps.astra.datastax.com",
			),
		).toBeInTheDocument();
		expect(screen.getByText("default_keyspace")).toBeInTheDocument();
	});

	it("falls back to default_keyspace label when keyspace is null", () => {
		render(
			<AstraCliDetectionCard
				info={{
					...detected,
					database: { ...detected.database, keyspace: null },
				}}
			/>,
		);
		expect(screen.getByText("default_keyspace")).toBeInTheDocument();
	});

	it("renders nothing when detection is not present", () => {
		const { container } = render(
			<AstraCliDetectionCard
				info={{ detected: false, reason: "binary-not-found" }}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});
});
