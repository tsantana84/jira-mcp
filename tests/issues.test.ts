import { describe, it, expect } from "vitest";
import { toADF, adfToPlainText, normalizeIssue, issueUrl } from "../src/jira/issues.js";

describe("ADF helpers", () => {
  it("toADF wraps plain text into minimal ADF", () => {
    const adf = toADF("Hello");
    expect(adf).toEqual({
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ],
    });
  });

  it("adfToPlainText flattens minimal ADF", () => {
    const adf = toADF("Line1");
    expect(adfToPlainText(adf)).toBe("Line1");
  });
});

describe("Issue normalization", () => {
  const baseUrl = "https://example.atlassian.net";

  it("issueUrl builds correct browse URL", () => {
    expect(issueUrl(baseUrl, "ABC-123")).toBe(
      "https://example.atlassian.net/browse/ABC-123"
    );
  });

  it("normalizeIssue maps core fields", () => {
    const raw = {
      id: 10001,
      key: "ABC-123",
      fields: {
        summary: "Fix login",
        status: {
          id: "3",
          name: "In Progress",
          statusCategory: { key: "indeterminate", name: "In Progress" },
        },
        assignee: { accountId: "u1", displayName: "User One" },
        reporter: { accountId: "u2", displayName: "User Two" },
        project: { id: 1, key: "ABC", name: "Alpha" },
        issuetype: { id: 10000, name: "Task" },
        labels: ["backend"],
        created: "2024-10-01T12:00:00.000Z",
        updated: "2024-10-02T12:00:00.000Z",
      },
    };
    const norm = normalizeIssue(raw, baseUrl);
    expect(norm).toMatchObject({
      id: "10001",
      key: "ABC-123",
      url: "https://example.atlassian.net/browse/ABC-123",
      summary: "Fix login",
      status: {
        id: "3",
        name: "In Progress",
        category: { key: "indeterminate", name: "In Progress" },
      },
      assignee: { accountId: "u1", displayName: "User One" },
      reporter: { accountId: "u2", displayName: "User Two" },
      project: { id: "1", key: "ABC", name: "Alpha" },
      issueType: { id: "10000", name: "Task" },
      labels: ["backend"],
      created: "2024-10-01T12:00:00.000Z",
      updated: "2024-10-02T12:00:00.000Z",
    });
  });
});

