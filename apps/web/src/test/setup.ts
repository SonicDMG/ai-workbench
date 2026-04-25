import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Belt-and-suspenders: vitest already calls cleanup between files when
// `restoreMocks: true` clears module-level state, but RTL's own
// auto-cleanup only fires when the test runner exposes its globals.
// We disabled `globals` in vitest.config.ts to keep imports explicit,
// so we run cleanup ourselves.
afterEach(() => {
	cleanup();
});
