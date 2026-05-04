/**
 * In-process Prometheus-format metrics registry. Pure-data tests;
 * the HTTP middleware that drives request counters lives in a
 * separate test file.
 */

import { describe, expect, test } from "vitest";
import {
	Counter,
	Gauge,
	Histogram,
	MetricsRegistry,
} from "../../src/lib/metrics.js";

describe("Counter", () => {
	test("increments by 1 by default and emits in text format", () => {
		const c = new Counter("test_total", "A test counter");
		c.inc({ status: "ok" });
		c.inc({ status: "ok" });
		c.inc({ status: "err" });
		const text = c.render();
		expect(text).toContain("# HELP test_total A test counter");
		expect(text).toContain("# TYPE test_total counter");
		expect(text).toContain('test_total{status="ok"} 2');
		expect(text).toContain('test_total{status="err"} 1');
	});

	test("escapes label values with quotes/backslashes/newlines", () => {
		const c = new Counter("test_total", "Counter");
		c.inc({ note: 'has "quotes" and \\ slash and\nnewline' });
		const text = c.render();
		expect(text).toContain(
			'test_total{note="has \\"quotes\\" and \\\\ slash and\\nnewline"} 1',
		);
	});

	test("inc with a custom delta", () => {
		const c = new Counter("test_total", "Counter");
		c.inc({}, 5);
		c.inc({}, 2.5);
		expect(c.render()).toContain("test_total 7.5");
	});

	test("rejects negative deltas (counter-monotonicity invariant)", () => {
		const c = new Counter("test_total", "Counter");
		expect(() => c.inc({}, -1)).toThrow();
	});

	test("no-label render", () => {
		const c = new Counter("test_total", "Counter");
		c.inc({});
		const text = c.render();
		expect(text).toContain("test_total 1");
		expect(text).not.toContain("{");
	});
});

describe("Gauge", () => {
	test("set + inc + dec render the latest value", () => {
		const g = new Gauge("queue_depth", "A gauge");
		g.set({ q: "ingest" }, 4);
		g.inc({ q: "ingest" });
		g.dec({ q: "ingest" }, 2);
		const text = g.render();
		expect(text).toContain('queue_depth{q="ingest"} 3');
		expect(text).toContain("# TYPE queue_depth gauge");
	});
});

describe("Histogram", () => {
	test("observe + render produces _bucket / _sum / _count lines", () => {
		const h = new Histogram("latency_seconds", "Latency", [0.01, 0.1, 1, 10]);
		h.observe({ route: "/x" }, 0.005);
		h.observe({ route: "/x" }, 0.05);
		h.observe({ route: "/x" }, 0.5);
		const text = h.render();
		expect(text).toContain("# TYPE latency_seconds histogram");
		// Cumulative buckets — 0.01 sees 1 (only 0.005), 0.1 sees 2,
		// 1 sees 3, +Inf sees 3. Labels render alphabetically.
		expect(text).toContain('latency_seconds_bucket{le="0.01",route="/x"} 1');
		expect(text).toContain('latency_seconds_bucket{le="0.1",route="/x"} 2');
		expect(text).toContain('latency_seconds_bucket{le="1",route="/x"} 3');
		expect(text).toContain('latency_seconds_bucket{le="+Inf",route="/x"} 3');
		expect(text).toContain('latency_seconds_sum{route="/x"} 0.555');
		expect(text).toContain('latency_seconds_count{route="/x"} 3');
	});

	test("rejects negative observations", () => {
		const h = new Histogram("latency_seconds", "Latency", [1]);
		expect(() => h.observe({}, -1)).toThrow();
	});
});

describe("MetricsRegistry", () => {
	test("registers + renders all metrics in deterministic order", () => {
		const reg = new MetricsRegistry();
		const c1 = new Counter("z_first_total", "");
		const c2 = new Counter("a_second_total", "");
		c1.inc({}, 1);
		c2.inc({}, 2);
		reg.register(c1);
		reg.register(c2);
		const text = reg.render();
		// Sorted by name so dashboards diff cleanly.
		expect(text.indexOf("a_second_total")).toBeLessThan(
			text.indexOf("z_first_total"),
		);
	});

	test("rejects duplicate names", () => {
		const reg = new MetricsRegistry();
		reg.register(new Counter("dupe", ""));
		expect(() => reg.register(new Counter("dupe", ""))).toThrow();
	});

	test("emits content-type-compatible exposition format", () => {
		const reg = new MetricsRegistry();
		reg.register(new Counter("only_total", "Only counter"));
		const text = reg.render();
		// Trailing newline required by spec.
		expect(text.endsWith("\n")).toBe(true);
	});
});
