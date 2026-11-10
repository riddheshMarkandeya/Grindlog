import { describe, expect, expectTypeOf, test } from "vitest";
import { aggregate, type Aggregate, type MyMatch } from "../aggregate";
import { aggregateSchema, statusSchema, type AggregateWire, type MyMatchWire } from "./responses";

describe("response schemas", () => {
  test("the query logic's types are the wire types, so neither drifts", () => {
    expectTypeOf<Aggregate>().toEqualTypeOf<AggregateWire>();
    expectTypeOf<MyMatch>().toEqualTypeOf<MyMatchWire>();
  });

  test("an empty aggregate (all nulls) parses", () => {
    expect(aggregateSchema.parse(aggregate([]))).toEqual(aggregate([]));
  });

  test("status carries the build's version (null outside a release) and the tracker's process ID", () => {
    const base = { connection: "waiting", statsApiOff: false, configProblems: [] };
    expect(statusSchema.parse({ ...base, version: "0.3.1", pid: 1234 })).toMatchObject({ version: "0.3.1", pid: 1234 });
    expect(statusSchema.parse({ ...base, version: null, pid: 1234 })).toMatchObject({ version: null });
    expect(statusSchema.safeParse({ ...base, version: null }).success).toBe(false);
  });
});
