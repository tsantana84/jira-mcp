import { describe, it, expect } from "vitest";
import {
  SearchIssuesInput,
  CreateIssueInput,
  EnvConfig,
} from "../src/schemas.js";

describe("Schemas", () => {
  it("SearchIssuesInput applies defaults", () => {
    const parsed = SearchIssuesInput.parse({ jql: "project = ABC" });
    expect(parsed.limit).toBe(25);
    expect(parsed.startAt).toBe(0);
  });

  it("CreateIssueInput requires summary", () => {
    const res = CreateIssueInput.safeParse({});
    expect(res.success).toBe(false);
  });

  it("EnvConfig validates required vars", () => {
    const res = EnvConfig.safeParse({});
    expect(res.success).toBe(false);
  });
});

