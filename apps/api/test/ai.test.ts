import { describe, expect, it } from "vitest";
import { normalizeProviderResponse } from "../src/services/ai";

describe("AI provider response normalization", () => {
  it("parses compact timetable image output", () => {
    const result = normalizeProviderResponse(
      {
        items: [
          {
            t: "高等数学",
            l: "德业楼205",
            slots: [
              { d: 3, s: "08:30", e: "09:15", p: "odd" },
              { d: 5, s: "10:25", e: "11:10", p: "all" },
            ],
            w: [],
          },
        ],
        transcript: "",
      },
      "Asia/Shanghai",
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item).toMatchObject({
      title: "高等数学",
      location: "德业楼205",
      importTarget: "timetable",
      periodMatch: "mapped",
    });
    expect(item.courseSlots).toEqual([
      { weekday: 3, startTime: "08:30", endTime: "09:15", weekParity: "odd" },
      { weekday: 5, startTime: "10:25", endTime: "11:10", weekParity: "all" },
    ]);
  });

  it("ignores a non-array compact warning field", () => {
    const result = normalizeProviderResponse(
      {
        items: [
          {
            t: "大学英语",
            slots: [{ d: 1, s: "08:00", e: "08:45" }],
            w: "not-an-array",
          },
        ],
      },
      "Asia/Shanghai",
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.warnings).toEqual([]);
  });
});
