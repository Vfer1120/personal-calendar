import { describe, expect, it } from "vitest";
import { ApiError } from "./api";

describe("ApiError", () => {
  it("preserves status, code and payload", () => {
    const error = new ApiError(409, "CONFLICT", "重叠", { conflicts: [1] });
    expect(error.status).toBe(409); expect(error.code).toBe("CONFLICT"); expect(error.payload).toEqual({ conflicts: [1] });
  });
});