import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, test } from "vitest";
import {
	RoutePluginRegistrationError,
	RoutePluginRegistry,
} from "../../src/plugins/registry.js";
import type {
	RoutePlugin,
	RoutePluginContext,
} from "../../src/plugins/types.js";

function fakePlugin(overrides: Partial<RoutePlugin> = {}): RoutePlugin {
	return {
		id: "fake",
		mountPath: "/api/v1/fake",
		build: () => new OpenAPIHono(),
		...overrides,
	};
}

describe("RoutePluginRegistry", () => {
	test("register returns the registry for chaining", () => {
		const registry = new RoutePluginRegistry();
		const result = registry.register(fakePlugin());
		expect(result).toBe(registry);
	});

	test("list returns plugins in registration order", () => {
		const registry = new RoutePluginRegistry();
		registry
			.register(fakePlugin({ id: "first", mountPath: "/a" }))
			.register(fakePlugin({ id: "second", mountPath: "/b" }))
			.register(fakePlugin({ id: "third", mountPath: "/c" }));
		expect(registry.list().map((p) => p.id)).toEqual([
			"first",
			"second",
			"third",
		]);
	});

	test("rejects duplicate ids", () => {
		const registry = new RoutePluginRegistry();
		registry.register(fakePlugin({ id: "shared" }));
		expect(() =>
			registry.register(fakePlugin({ id: "shared", mountPath: "/other" })),
		).toThrow(RoutePluginRegistrationError);
	});

	test("rejects malformed ids", () => {
		const registry = new RoutePluginRegistry();
		for (const bad of [
			"",
			"Has-Caps",
			"kebab-case",
			"1starts_with_digit",
			"a b",
		]) {
			expect(
				() => registry.register(fakePlugin({ id: bad })),
				`expected "${bad}" to be rejected`,
			).toThrow(RoutePluginRegistrationError);
		}
	});

	test("rejects mountPaths that do not start with /", () => {
		const registry = new RoutePluginRegistry();
		expect(() =>
			registry.register(fakePlugin({ mountPath: "api/v1/oops" })),
		).toThrow(RoutePluginRegistrationError);
	});

	test("get returns the registered plugin or undefined", () => {
		const registry = new RoutePluginRegistry();
		const plugin = fakePlugin({ id: "lookup_me" });
		registry.register(plugin);
		expect(registry.get("lookup_me")).toBe(plugin);
		expect(registry.get("missing")).toBeUndefined();
	});

	test("size reflects the number of registrations", () => {
		const registry = new RoutePluginRegistry();
		expect(registry.size).toBe(0);
		registry.register(fakePlugin({ id: "a" }));
		registry.register(fakePlugin({ id: "b" }));
		expect(registry.size).toBe(2);
	});

	test("list returns an isolated snapshot", () => {
		const registry = new RoutePluginRegistry();
		registry.register(fakePlugin({ id: "only" }));
		const first = registry.list();
		registry.register(fakePlugin({ id: "two", mountPath: "/x" }));
		const second = registry.list();
		expect(first).toHaveLength(1);
		expect(second).toHaveLength(2);
	});

	test("build is called by the host, not at registration time", () => {
		let buildCalls = 0;
		const plugin: RoutePlugin = {
			id: "lazy",
			mountPath: "/lazy",
			build: (_ctx: RoutePluginContext) => {
				buildCalls += 1;
				return new OpenAPIHono();
			},
		};
		const registry = new RoutePluginRegistry();
		registry.register(plugin);
		expect(buildCalls).toBe(0);
	});
});
