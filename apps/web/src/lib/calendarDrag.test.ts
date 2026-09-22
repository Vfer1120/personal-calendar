import { describe, expect, it } from "vitest";
import { normalizeOccurrenceTimes } from "./calendarDrag";

const originalStart = new Date(2026, 8, 17, 10, 7, 0, 0);
const originalEnd = new Date(2026, 8, 17, 11, 7, 0, 0);

describe("calendar drag normalization", () => {
  it("keeps day-view moves on the original date and snaps to 30 minutes", () => {
    const result = normalizeOccurrenceTimes({
      view: "day",
      operation: "move",
      resizeEdge: "end",
      originalStart,
      originalEnd,
      candidateStart: new Date(2026, 8, 18, 23, 50),
      candidateEnd: new Date(2026, 8, 18, 0, 50)
    });
    expect(result.start.getFullYear()).toBe(2026);
    expect(result.start.getMonth()).toBe(8);
    expect(result.start.getDate()).toBe(17);
    expect(result.end.getTime() - result.start.getTime()).toBe(60 * 60_000);
    expect(result.start.getMinutes() % 30).toBe(0);
  });

  it("preserves time of day when moving in month view", () => {
    const result = normalizeOccurrenceTimes({
      view: "month",
      operation: "move",
      resizeEdge: "end",
      originalStart,
      originalEnd,
      candidateStart: new Date(2026, 8, 25, 0, 0),
      candidateEnd: new Date(2026, 8, 25, 0, 0)
    });
    expect(result.start.getDate()).toBe(25);
    expect(result.start.getHours()).toBe(10);
    expect(result.start.getMinutes()).toBe(7);
    expect(result.end.getHours()).toBe(11);
    expect(result.end.getMinutes()).toBe(7);
  });

  it("moves a rolling week horizontally without changing the clock time", () => {
    const result = normalizeOccurrenceTimes({
      view: "week",
      operation: "move",
      resizeEdge: "end",
      originalStart,
      originalEnd,
      candidateStart: new Date(2026, 8, 18, 10, 7, 0, 0),
      candidateEnd: new Date(2026, 8, 18, 11, 7, 0, 0)
    });
    expect(result.start.getDate()).toBe(18);
    expect(result.start.getHours()).toBe(10);
    expect(result.start.getMinutes()).toBe(7);
    expect(result.end.getTime() - result.start.getTime()).toBe(60 * 60_000);
  });

  it("moves a rolling week vertically while keeping the date", () => {
    const result = normalizeOccurrenceTimes({
      view: "week",
      operation: "move",
      resizeEdge: "end",
      originalStart,
      originalEnd,
      candidateStart: new Date(2026, 8, 17, 11, 22),
      candidateEnd: new Date(2026, 8, 17, 12, 22)
    });
    expect(result.start.getDate()).toBe(17);
    expect(result.start.getHours()).toBe(11);
    expect(result.start.getMinutes()).toBe(30);
    expect(result.end.getTime() - result.start.getTime()).toBe(60 * 60_000);
  });

  it("moves a rolling week diagonally with both date and time", () => {
    const result = normalizeOccurrenceTimes({
      view: "week",
      operation: "move",
      resizeEdge: "end",
      originalStart,
      originalEnd,
      candidateStart: new Date(2026, 8, 18, 14, 45),
      candidateEnd: new Date(2026, 8, 18, 15, 45),
      rangeStart: new Date(2026, 8, 17, 0, 0),
      rangeEnd: new Date(2026, 8, 24, 0, 0)
    });
    expect(result.start.getDate()).toBe(18);
    expect(result.start.getHours()).toBe(15);
    expect(result.start.getMinutes()).toBe(0);
    expect(result.end.getTime() - result.start.getTime()).toBe(60 * 60_000);
  });

  it("clamps a rolling week move to the visible range", () => {
    const result = normalizeOccurrenceTimes({
      view: "week",
      operation: "move",
      resizeEdge: "end",
      originalStart,
      originalEnd,
      candidateStart: new Date(2026, 8, 25, 10, 7),
      candidateEnd: new Date(2026, 8, 25, 11, 7),
      rangeStart: new Date(2026, 8, 17, 0, 0),
      rangeEnd: new Date(2026, 8, 24, 0, 0)
    });
    expect(result.start.getDate()).toBe(23);
    expect(result.start.getHours()).toBe(10);
    expect(result.start.getMinutes()).toBe(7);
    expect(result.end.getTime()).toBeLessThanOrEqual(new Date(2026, 8, 24, 0, 0).getTime());
  });

  it("clamps a late rolling week move to the range end", () => {
    const result = normalizeOccurrenceTimes({
      view: "week",
      operation: "move",
      resizeEdge: "end",
      originalStart,
      originalEnd,
      candidateStart: new Date(2026, 8, 25, 23, 45),
      candidateEnd: new Date(2026, 8, 26, 0, 45),
      rangeStart: new Date(2026, 8, 17, 0, 0),
      rangeEnd: new Date(2026, 8, 24, 0, 0)
    });
    expect(result.start.getDate()).toBe(23);
    expect(result.start.getHours()).toBe(23);
    expect(result.start.getMinutes()).toBe(0);
    expect(result.end.getTime()).toBe(new Date(2026, 8, 24, 0, 0).getTime());
  });

  it("resizes a rolling week edge by time while keeping the date", () => {
    const result = normalizeOccurrenceTimes({
      view: "week",
      operation: "resize",
      resizeEdge: "end",
      originalStart,
      originalEnd,
      candidateStart: new Date(2026, 8, 18, 10, 7),
      candidateEnd: new Date(2026, 8, 18, 12, 10),
      rangeStart: new Date(2026, 8, 17, 0, 0),
      rangeEnd: new Date(2026, 8, 24, 0, 0)
    });
    expect(result.start.getTime()).toBe(originalStart.getTime());
    expect(result.end.getDate()).toBe(18);
    expect(result.end.getHours()).toBe(12);
    expect(result.end.getMinutes()).toBe(0);
  });

  it("clamps a month move to the current month without changing time", () => {
    const result = normalizeOccurrenceTimes({
      view: "month",
      operation: "move",
      resizeEdge: "end",
      originalStart,
      originalEnd,
      candidateStart: new Date(2026, 9, 1, 0, 0),
      candidateEnd: new Date(2026, 9, 1, 0, 0),
      rangeStart: new Date(2026, 8, 1, 0, 0),
      rangeEnd: new Date(2026, 9, 1, 0, 0)
    });
    expect(result.start.getMonth()).toBe(8);
    expect(result.start.getDate()).toBe(30);
    expect(result.start.getHours()).toBe(10);
    expect(result.start.getMinutes()).toBe(7);
  });
});
