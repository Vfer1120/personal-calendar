import { describe, expect, it } from "vitest";
import { findById, replaceById } from "./itemCache";

type TestItem = { id: string; status: "active" | "completed"; version: number };
const items: TestItem[] = [
  { id: "a", status: "active", version: 1 },
  { id: "b", status: "active", version: 2 },
  { id: "c", status: "active", version: 3 }
];

describe("item cache helpers", () => {
  it("finds an item by id", () => {
    expect(findById(items, "b")).toBe(items[1]);
    expect(findById(items, "missing")).toBeUndefined();
  });

  it("replaces only the matching item and preserves order and identity", () => {
    const replacement: TestItem = { id: "b", status: "completed", version: 3 };
    const next = replaceById(items, replacement);

    expect(next.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(next[0]).toBe(items[0]);
    expect(next[1]).toBe(replacement);
    expect(next[2]).toBe(items[2]);
    expect(next[0]!.status).toBe("active");
    expect(next[2]!.status).toBe("active");
  });

  it("appends a new item when it is not in the cache", () => {
    const replacement: TestItem = { id: "d", status: "active", version: 1 };
    expect(replaceById(items, replacement)).toEqual([...items, replacement]);
  });
});